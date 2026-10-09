use crate::errors::ExecutionError;
use crate::execution::jito_client::{JitoBundle, JitoClient};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RegionalBlockEngine {
    Amsterdam,
    Frankfurt,
    NewYork,
    Tokyo,
    SaltLakeCity,
}

impl RegionalBlockEngine {
    pub fn endpoint_url(&self) -> &'static str {
        match self {
            Self::Amsterdam => "https://amsterdam.mainnet.block-engine.jito.wtf",
            Self::Frankfurt => "https://frankfurt.mainnet.block-engine.jito.wtf",
            Self::NewYork => "https://ny.mainnet.block-engine.jito.wtf",
            Self::Tokyo => "https://tokyo.mainnet.block-engine.jito.wtf",
            Self::SaltLakeCity => "https://slc.mainnet.block-engine.jito.wtf",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendReceipt {
    pub bundle_id: String,
    pub routed_via: String,
    pub submitted_at_ms: u64,
}

pub struct SendRouter {
    pub primary_jito: Box<dyn JitoClient>,
    pub fallback_relay: Option<Box<dyn JitoClient>>,
    pub allow_public_rpc_fallback: bool, // Strict MEV protection: default false
    pub submitted_bundles: Arc<RwLock<HashSet<String>>>,
}

impl SendRouter {
    pub fn new(
        primary_jito: Box<dyn JitoClient>,
        fallback_relay: Option<Box<dyn JitoClient>>,
        allow_public_rpc_fallback: bool,
    ) -> Self {
        Self {
            primary_jito,
            fallback_relay,
            allow_public_rpc_fallback,
            submitted_bundles: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// Check if bundle ID was already submitted (deduplication)
    pub async fn is_duplicate(&self, bundle_id: &str) -> bool {
        let guard = self.submitted_bundles.read().await;
        guard.contains(bundle_id)
    }

    /// Route bundle with private execution guarantees (no public mempool leakage)
    pub async fn send_bundle(&self, bundle: &JitoBundle) -> Result<SendReceipt, ExecutionError> {
        // Enforce deduplication
        {
            let mut guard = self.submitted_bundles.write().await;
            if guard.contains(&bundle.bundle_id) {
                return Err(ExecutionError::BundleRejected {
                    reason: format!("Duplicate bundle submission rejected: {}", bundle.bundle_id),
                });
            }
            guard.insert(bundle.bundle_id.clone());
        }

        // 1. Try Primary Jito Block Engine
        match self.primary_jito.send_bundle(bundle).await {
            Ok(receipt) => Ok(SendReceipt {
                bundle_id: receipt.bundle_id,
                routed_via: "PrimaryJito".to_string(),
                submitted_at_ms: receipt.submitted_at_ms,
            }),
            Err(primary_err) => {
                // 2. Try private fallback relay if configured
                if let Some(ref relay) = self.fallback_relay {
                    match relay.send_bundle(bundle).await {
                        Ok(receipt) => Ok(SendReceipt {
                            bundle_id: receipt.bundle_id,
                            routed_via: "PrivateRelay".to_string(),
                            submitted_at_ms: receipt.submitted_at_ms,
                        }),
                        Err(relay_err) => Err(ExecutionError::BundleRejected {
                            reason: format!(
                                "Both Primary Jito ({}) and Private Relay ({}) failed",
                                primary_err, relay_err
                            ),
                        }),
                    }
                } else {
                    // MEV GUARDRAIL: Do not fall back to public RPC mempool
                    Err(primary_err)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::mock_jito::MockJitoClient;
    use crate::types::Pubkey;

    #[tokio::test]
    async fn test_send_router_primary_and_fallback() {
        let primary_mock = MockJitoClient::new();
        let fallback_mock = MockJitoClient::new();

        // Make primary fail
        primary_mock
            .set_forced_error(Some("Block engine connection error".to_string()))
            .await;

        let router = SendRouter::new(
            Box::new(primary_mock),
            Some(Box::new(fallback_mock.clone())),
            false,
        );

        let bundle = JitoBundle {
            bundle_id: "test_b1".to_string(),
            serialized_transactions: vec![vec![1, 2, 3]],
            tip_lamports: 1_000_000,
            tip_account: Pubkey::new_unique(),
        };

        let receipt = router.send_bundle(&bundle).await.unwrap();
        assert_eq!(receipt.routed_via, "PrivateRelay");
        assert_eq!(fallback_mock.get_submitted_count().await, 1);
    }
}
