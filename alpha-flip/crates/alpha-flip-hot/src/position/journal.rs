use crate::errors::PositionInvariantError;
use crate::types::{Lamports, Mint, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Distinct lifecycle events for the append-only position journal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum JournalEvent {
    /// Signal received and evaluated, decision to enter trade formed
    IntentOpen {
        mint: Mint,
        max_sol: Lamports,
        slot: Slot,
        client_order_id: String,
    },
    /// Jito bundle prepared and submitted to block engine
    BundleSubmitted {
        mint: Mint,
        bundle_id: String,
        tip_lamports: Lamports,
        slot: Slot,
    },
    /// Buy transaction landed on-chain with confirmed signature and token fill
    BuyLanded {
        mint: Mint,
        signature: Signature,
        tokens_acquired: TokenAmount,
        sol_spent: Lamports,
        effective_price: f64,
        slot: Slot,
    },
    /// Buy failed (bundle dropped, simulation error, expired blockhash)
    BuyFailed {
        mint: Mint,
        bundle_id: String,
        reason: String,
        slot: Slot,
    },
    /// State machine formally transitioned to IN_POSITION
    PositionOpen {
        mint: Mint,
        entry_price: f64,
        entry_sol: Lamports,
        token_amount: TokenAmount,
        opened_slot: Slot,
        initial_sig: Signature,
    },
    /// Ladder or trigger requested exit for specific tier (1, 2, or full)
    TierRequested {
        mint: Mint,
        tier: u8,
        token_amount: TokenAmount,
        min_sol_out: Lamports,
        slot: Slot,
    },
    /// Exit bundle submitted to Jito
    TierSubmitted {
        mint: Mint,
        tier: u8,
        bundle_id: String,
        tip_lamports: Lamports,
        slot: Slot,
    },
    /// Exit transaction landed on-chain
    TierLanded {
        mint: Mint,
        tier: u8,
        signature: Signature,
        tokens_sold: TokenAmount,
        sol_received: Lamports,
        slot: Slot,
    },
    /// Immediate emergency exit triggered (dev dump, adverse selection, kill switch)
    EmergencyRequested {
        mint: Mint,
        reason: String,
        tokens_to_sell: TokenAmount,
        slot: Slot,
    },
    /// All acquired tokens successfully sold; position fully exited
    PositionClosed {
        mint: Mint,
        total_sol_returned: Lamports,
        net_pnl_sol: i64,
        closed_slot: Slot,
    },
    /// Discrepancy detected during startup or execution requiring manual/safe resolution
    ReconciliationRequired {
        mint: Mint,
        reason: String,
        wallet_token_balance: TokenAmount,
        expected_token_balance: TokenAmount,
        slot: Slot,
    },
}

/// A serialized entry in the journal with monotonic ID, timestamp, and idempotency key
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JournalRecord {
    pub record_id: u64,
    pub timestamp_ms: u64,
    pub idempotency_key: String,
    pub event: JournalEvent,
}

/// Append-only durable journal for atomic crash recovery & audit trail.
/// Thread-safe via internal Arc<Mutex<...>> and synchronous write/flush (WAL style).
#[derive(Debug, Clone)]
pub struct PositionJournal {
    path: PathBuf,
    inner: Arc<Mutex<JournalInner>>,
}

#[derive(Debug)]
struct JournalInner {
    file: Option<File>,
    next_record_id: u64,
    idempotency_keys: std::collections::HashSet<String>,
}

impl PositionJournal {
    /// Create or open existing journal at specified file path.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, PositionInvariantError> {
        let path_buf = path.as_ref().to_path_buf();
        if let Some(parent) = path_buf.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }

        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(&path_buf)
            .map_err(|e| PositionInvariantError::Other(format!("Failed to open journal file: {}", e)))?;

        // Replay existing records to calculate next_record_id and index idempotency keys
        let (next_id, keys) = Self::scan_existing_records(&path_buf)?;

        Ok(Self {
            path: path_buf,
            inner: Arc::new(Mutex::new(JournalInner {
                file: Some(file),
                next_record_id: next_id,
                idempotency_keys: keys,
            })),
        })
    }

    /// In-memory ephemeral journal for testing without disk side-effects
    pub fn ephemeral() -> Self {
        Self {
            path: PathBuf::from(":memory:"),
            inner: Arc::new(Mutex::new(JournalInner {
                file: None,
                next_record_id: 1,
                idempotency_keys: std::collections::HashSet::new(),
            })),
        }
    }

    fn scan_existing_records(path: &Path) -> Result<(u64, std::collections::HashSet<String>), PositionInvariantError> {
        let file = File::open(path)
            .map_err(|e| PositionInvariantError::Other(format!("Failed to read journal: {}", e)))?;
        let reader = BufReader::new(file);

        let mut max_id = 0u64;
        let mut keys = std::collections::HashSet::new();

        for line_res in reader.lines() {
            let line = line_res.map_err(|e| PositionInvariantError::Other(format!("Journal line read error: {}", e)))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<JournalRecord>(trimmed) {
                if rec.record_id > max_id {
                    max_id = rec.record_id;
                }
                keys.insert(rec.idempotency_key);
            }
        }

        Ok((max_id + 1, keys))
    }

    /// Append event with idempotency guard. Returns Ok(true) if newly appended,
    /// Ok(false) if idempotency_key was already present (duplicate suppressed).
    pub fn append(
        &self,
        idempotency_key: impl Into<String>,
        event: JournalEvent,
    ) -> Result<bool, PositionInvariantError> {
        let key = idempotency_key.into();
        let mut guard = self.inner.lock().map_err(|_| {
            PositionInvariantError::Other("Journal mutex poisoned".to_string())
        })?;

        if guard.idempotency_keys.contains(&key) {
            return Ok(false);
        }

        let record_id = guard.next_record_id;
        guard.next_record_id += 1;
        guard.idempotency_keys.insert(key.clone());

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let record = JournalRecord {
            record_id,
            timestamp_ms,
            idempotency_key: key,
            event,
        };

        if let Some(ref mut file) = guard.file {
            let serialized = serde_json::to_string(&record).map_err(|e| {
                PositionInvariantError::Other(format!("JSON serialization failed: {}", e))
            })?;
            writeln!(file, "{}", serialized).map_err(|e| {
                PositionInvariantError::Other(format!("Journal write failed: {}", e))
            })?;
            file.flush().map_err(|e| {
                PositionInvariantError::Other(format!("Journal flush failed: {}", e))
            })?;
        }

        Ok(true)
    }

    /// Read all records from the journal in chronological order
    pub fn read_all(&self) -> Result<Vec<JournalRecord>, PositionInvariantError> {
        if self.path == PathBuf::from(":memory:") {
            return Ok(Vec::new());
        }

        let file = File::open(&self.path)
            .map_err(|e| PositionInvariantError::Other(format!("Failed to open journal for replay: {}", e)))?;
        let reader = BufReader::new(file);

        let mut records = Vec::new();
        for line in reader.lines() {
            let line = line.map_err(|e| PositionInvariantError::Other(format!("Read line error: {}", e)))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let rec = serde_json::from_str::<JournalRecord>(trimmed).map_err(|e| {
                PositionInvariantError::Other(format!("Corrupt journal record: {}", e))
            })?;
            records.push(rec);
        }

        Ok(records)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ephemeral_journal_idempotency() {
        let journal = PositionJournal::ephemeral();
        let event = JournalEvent::IntentOpen {
            mint: Mint::from_bytes([1u8; 32]),
            max_sol: Lamports::new(100_000_000),
            slot: 100,
            client_order_id: "order-1".to_string(),
        };

        let first = journal.append("key-1", event.clone()).unwrap();
        assert!(first);

        let second = journal.append("key-1", event).unwrap();
        assert!(!second, "Duplicate idempotency key must be ignored");
    }

    #[test]
    fn test_file_journal_persistence_and_replay() {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join(format!("test_journal_{}.jsonl", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));

        let journal = PositionJournal::open(&path).unwrap();
        let mint = Mint::from_bytes([2u8; 32]);
        journal.append("intent-1", JournalEvent::IntentOpen {
            mint,
            max_sol: Lamports::new(50_000_000),
            slot: 200,
            client_order_id: "cid-1".to_string(),
        }).unwrap();

        journal.append("landed-1", JournalEvent::BuyLanded {
            mint,
            signature: Signature::from_bytes([3u8; 64]),
            tokens_acquired: TokenAmount::new(1000),
            sol_spent: Lamports::new(50_000_000),
            effective_price: 0.05,
            slot: 205,
        }).unwrap();

        // Reopen from disk
        let reopened = PositionJournal::open(&path).unwrap();
        let records = reopened.read_all().unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].record_id, 1);
        assert_eq!(records[1].record_id, 2);

        // Verify idempotency persisted across restart
        let dup = reopened.append("intent-1", JournalEvent::IntentOpen {
            mint,
            max_sol: Lamports::new(50_000_000),
            slot: 200,
            client_order_id: "cid-1".to_string(),
        }).unwrap();
        assert!(!dup);

        let _ = std::fs::remove_file(&path);
    }
}
