use crate::grpc::transport::{AccountUpdateFrame, SlotUpdateFrame, TransactionUpdateFrame};
use crate::types::{Slot, WriteVersion};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Sanitized replay log entry.
///
/// CRITICAL SECURITY INVARIANT:
/// Replay records MUST NEVER record private keys, seed phrases, or sensitive secret bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayRecord {
    pub timestamp_ms: u64,
    pub record_type: String, // "ACCOUNT", "TRANSACTION", "SLOT"
    pub slot: Slot,
    pub write_version: WriteVersion,
    pub identifier: String, // Base58 Pubkey or Signature
    pub payload_size: usize,
    pub metadata_summary: String,
}

#[derive(Debug, Default, Clone)]
pub struct ReplayRecorder {
    records: Arc<RwLock<Vec<ReplayRecord>>>,
    records_written: Arc<AtomicU64>,
    max_in_memory_records: usize,
}

impl ReplayRecorder {
    pub fn new(max_in_memory_records: usize) -> Self {
        Self {
            records: Arc::new(RwLock::new(Vec::with_capacity(1024))),
            records_written: Arc::new(AtomicU64::new(0)),
            max_in_memory_records,
        }
    }

    pub fn records_written(&self) -> u64 {
        self.records_written.load(Ordering::Relaxed)
    }

    pub async fn record_account(&self, frame: &AccountUpdateFrame, timestamp_ms: u64) {
        let record = ReplayRecord {
            timestamp_ms,
            record_type: "ACCOUNT".to_string(),
            slot: frame.slot,
            write_version: frame.write_version,
            identifier: frame.pubkey.to_string(),
            payload_size: frame.data.len(),
            metadata_summary: format!(
                "lamports={}, owner={}, executable={}",
                frame.lamports, frame.owner, frame.executable
            ),
        };
        self.append_record(record).await;
    }

    pub async fn record_transaction(&self, frame: &TransactionUpdateFrame, timestamp_ms: u64) {
        let record = ReplayRecord {
            timestamp_ms,
            record_type: "TRANSACTION".to_string(),
            slot: frame.slot,
            write_version: WriteVersion::ZERO,
            identifier: frame.signature.to_string(),
            payload_size: frame.account_keys.len(),
            metadata_summary: format!(
                "is_vote={}, accounts_count={}, logs_count={}, err={:?}",
                frame.is_vote,
                frame.account_keys.len(),
                frame.log_messages.len(),
                frame.err
            ),
        };
        self.append_record(record).await;
    }

    pub async fn record_slot(&self, frame: &SlotUpdateFrame, timestamp_ms: u64) {
        let record = ReplayRecord {
            timestamp_ms,
            record_type: "SLOT".to_string(),
            slot: frame.slot,
            write_version: WriteVersion::ZERO,
            identifier: format!("slot_{}", frame.slot.as_u64()),
            payload_size: 0,
            metadata_summary: format!("status={}, parent={:?}", frame.status, frame.parent_slot),
        };
        self.append_record(record).await;
    }

    async fn append_record(&self, record: ReplayRecord) {
        let mut recs = self.records.write().await;
        if recs.len() >= self.max_in_memory_records && self.max_in_memory_records > 0 {
            recs.remove(0); // Evict oldest record to bound memory
        }
        recs.push(record);
        self.records_written.fetch_add(1, Ordering::Relaxed);
    }

    pub async fn get_records(&self) -> Vec<ReplayRecord> {
        let recs = self.records.read().await;
        recs.clone()
    }

    /// Export records formatted as newline-delimited JSON (JSONL)
    pub async fn export_jsonl(&self) -> Result<String, serde_json::Error> {
        let recs = self.records.read().await;
        let mut lines = Vec::with_capacity(recs.len());
        for r in recs.iter() {
            lines.push(serde_json::to_string(r)?);
        }
        Ok(lines.join("\n"))
    }
}
