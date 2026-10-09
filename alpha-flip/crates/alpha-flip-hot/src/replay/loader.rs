use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::errors::HotError;
use crate::grpc::transport::{AccountUpdateFrame, SlotUpdateFrame, TransactionUpdateFrame};
use crate::types::{Mint, Slot};

/// Replay frame kind representing events recorded from Yellowstone gRPC or normalized pipeline
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ReplayFrame {
    Slot(SlotUpdateFrame),
    Transaction(TransactionUpdateFrame),
    Account(AccountUpdateFrame),
}

impl ReplayFrame {
    pub fn slot(&self) -> Slot {
        match self {
            ReplayFrame::Slot(s) => s.slot,
            ReplayFrame::Transaction(tx) => tx.slot,
            ReplayFrame::Account(acc) => acc.slot,
        }
    }
}

/// Streaming reader that parses JSONL replay files line-by-line
pub struct ReplayLoader;

impl ReplayLoader {
    /// Load all frames from a JSONL file into memory (sorted monotonically by slot)
    pub fn load_file<P: AsRef<Path>>(path: P) -> Result<Vec<ReplayFrame>, HotError> {
        let file = File::open(path.as_ref()).map_err(|e| {
            HotError::Config(format!(
                "Failed to open replay file {}: {}",
                path.as_ref().display(),
                e
            ))
        })?;
        let reader = BufReader::new(file);
        let mut frames = Vec::new();

        for (idx, line) in reader.lines().enumerate() {
            let line = line.map_err(|e| {
                HotError::Config(format!("Error reading line {} from replay file: {}", idx + 1, e))
            })?;
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let frame: ReplayFrame = serde_json::from_str(trimmed).map_err(|e| {
                HotError::Config(format!(
                    "Malformed JSONL replay frame at line {}: {}",
                    idx + 1,
                    e
                ))
            })?;
            frames.push(frame);
        }

        // Sort monotonically by slot to guarantee logical clock determinism
        frames.sort_by_key(|f| f.slot());

        Ok(frames)
    }

    /// Parse frames directly from a raw string (useful for embedded fixtures & tests)
    pub fn load_str(jsonl_content: &str) -> Result<Vec<ReplayFrame>, HotError> {
        let mut frames = Vec::new();
        for (idx, line) in jsonl_content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let frame: ReplayFrame = serde_json::from_str(trimmed).map_err(|e| {
                HotError::Config(format!(
                    "Malformed JSONL replay frame at line {}: {}",
                    idx + 1,
                    e
                ))
            })?;
            frames.push(frame);
        }
        frames.sort_by_key(|f| f.slot());
        Ok(frames)
    }
}
