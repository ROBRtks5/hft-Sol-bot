use crate::errors::ExecutionError;
use crate::execution::jito_client::{BundleStatus, BundleSubmissionResult, JitoBundle, JitoClient};
use crate::types::{Pubkey, Signature};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct MockJitoClient {
    pub tip_accounts: Vec<Pubkey>,
    pub simulated_landed_rate: f64, // e.g. 0.90
    pub submitted_bundles: Arc<RwLock<Vec<JitoBundle>>>,
    pub bundle_statuses: Arc<RwLock<HashMap<String, BundleStatus>>>,
    pub forced_error: Arc<RwLock<Option<String>>>,
    pub counter: Arc<AtomicU64>,
}

impl Default for MockJitoClient {
    fn default() -> Self {
        Self::new()
    }
}

impl MockJitoClient {
    pub fn new() -> Self {
        let dummy_tip = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"
            .parse::<Pubkey>()
            .unwrap_or_default();

        Self {
            tip_accounts: vec![dummy_tip],
            simulated_landed_rate: 1.0,
            submitted_bundles: Arc::new(RwLock::new(Vec::new())),
            bundle_statuses: Arc::new(RwLock::new(HashMap::new())),
            forced_error: Arc::new(RwLock::new(None)),
            counter: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn with_landed_rate(mut self, rate: f64) -> Self {
        self.simulated_landed_rate = rate;
        self
    }

    pub async fn set_forced_error(&self, err: Option<String>) {
        let mut fe = self.forced_error.write().await;
        *fe = err;
    }

    pub async fn set_bundle_status(&self, bundle_id: String, status: BundleStatus) {
        let mut map = self.bundle_statuses.write().await;
        map.insert(bundle_id, status);
    }

    pub async fn get_submitted_count(&self) -> usize {
        let list = self.submitted_bundles.read().await;
        list.len()
    }
}

#[async_trait]
impl JitoClient for MockJitoClient {
    async fn send_bundle(&self, bundle: &JitoBundle) -> Result<BundleSubmissionResult, ExecutionError> {
        let err_guard = self.forced_error.read().await;
        if let Some(ref err_msg) = *err_guard {
            return Err(ExecutionError::BundleRejected {
                reason: err_msg.clone(),
            });
        }

        let mut list = self.submitted_bundles.write().await;
        list.push(bundle.clone());

        let count = self.counter.fetch_add(1, Ordering::SeqCst);
        let bundle_id = bundle.bundle_id.clone();

        // Seed default status based on landed rate
        let mut statuses = self.bundle_statuses.write().await;
        if !statuses.contains_key(&bundle_id) {
            let pseudo_rnd = ((count * 13) % 100) as f64 / 100.0;
            if pseudo_rnd <= self.simulated_landed_rate {
                let dummy_sig = Signature::default();
                statuses.insert(
                    bundle_id.clone(),
                    BundleStatus::Landed {
                        slot: 1000 + count,
                        signature: dummy_sig,
                    },
                );
            } else {
                statuses.insert(
                    bundle_id.clone(),
                    BundleStatus::Failed {
                        reason: "Simulation drop: Block leader missed bundle".to_string(),
                    },
                );
            }
        }

        Ok(BundleSubmissionResult {
            bundle_id,
            accepted: true,
            submitted_at_ms: 1_700_000_000_000 + count,
        })
    }

    async fn get_tip_accounts(&self) -> Result<Vec<Pubkey>, ExecutionError> {
        if self.tip_accounts.is_empty() {
            Err(ExecutionError::NoTipAccountsAvailable)
        } else {
            Ok(self.tip_accounts.clone())
        }
    }

    async fn get_bundle_status(&self, bundle_id: &str) -> Result<BundleStatus, ExecutionError> {
        let map = self.bundle_statuses.read().await;
        if let Some(status) = map.get(bundle_id) {
            Ok(status.clone())
        } else {
            Ok(BundleStatus::Pending)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_jito_submission_and_status() {
        let client = MockJitoClient::new();
        let bundle = JitoBundle {
            bundle_id: "bundle_123".to_string(),
            serialized_transactions: vec![vec![1, 2, 3]],
            tip_lamports: 1_000_000,
            tip_account: Pubkey::new_unique(),
        };

        let res = client.send_bundle(&bundle).await.unwrap();
        assert_eq!(res.bundle_id, "bundle_123");
        assert_eq!(client.get_submitted_count().await, 1);

        let status = client.get_bundle_status("bundle_123").await.unwrap();
        assert!(matches!(status, BundleStatus::Landed { .. }));
    }
}
