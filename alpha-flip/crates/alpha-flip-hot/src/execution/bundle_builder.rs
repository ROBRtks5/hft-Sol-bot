use crate::errors::ExecutionError;
use crate::execution::jito_client::JitoBundle;
use crate::types::{Blockhash, Pubkey};
use serde::{Deserialize, Serialize};

pub const COMPUTE_BUDGET_PROGRAM: &str = "ComputeBudget111111111111111111111111111111";
pub const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
pub const JITO_DONT_FRONT_PUBKEY: &str = "jitodontfront1111111111111111111111111111";

/// Solana IPv6 MTU packet limit: 1280 - 40 (IPv6) - 8 (UDP) = 1232 bytes
pub const SOLANA_MAX_PACKET_SIZE: usize = 1232;
/// Jito atomic bundle strict transaction limit (<= 5 transactions)
pub const MAX_BUNDLE_TRANSACTIONS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountMeta {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Instruction {
    pub program_id: Pubkey,
    pub accounts: Vec<AccountMeta>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct BundleBuilder {
    pub dont_front_account: Pubkey,
    pub compute_budget_program: Pubkey,
    pub system_program: Pubkey,
}

impl Default for BundleBuilder {
    fn default() -> Self {
        Self {
            dont_front_account: JITO_DONT_FRONT_PUBKEY.parse().unwrap_or_default(),
            compute_budget_program: COMPUTE_BUDGET_PROGRAM.parse().unwrap_or_default(),
            system_program: SYSTEM_PROGRAM.parse().unwrap_or_default(),
        }
    }
}

impl BundleBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Construct ordered list of instructions adhering to Jito MEV protection invariants:
    /// Index 0: Read-only jitodontfront account marker
    /// Index 1: ComputeBudget set_compute_unit_limit
    /// Index 2: ComputeBudget set_compute_unit_price
    /// Index 3: Swap instruction (Pump.fun or Raydium)
    /// Index 4: Tip transfer to verified Jito tip account
    pub fn build_ordered_instructions(
        &self,
        swap_ix: Instruction,
        cu_limit: u32,
        cu_price_micro_lamports: u64,
        tip_account: Pubkey,
        tip_lamports: u64,
        signer: Pubkey,
    ) -> Result<Vec<Instruction>, ExecutionError> {
        if tip_lamports == 0 {
            return Err(ExecutionError::BundleRejected {
                reason: "Tip lamports must be strictly positive".to_string(),
            });
        }

        let mut instructions = Vec::with_capacity(5);

        // Index 0: jitodontfront marker instruction (read-only reference)
        instructions.push(Instruction {
            program_id: self.system_program,
            accounts: vec![AccountMeta {
                pubkey: self.dont_front_account,
                is_signer: false,
                is_writable: false,
            }],
            data: vec![255], // No-op / marker tag
        });

        // Index 1: ComputeBudget set_compute_unit_limit (discriminator 2)
        let mut limit_data = vec![2];
        limit_data.extend_from_slice(&cu_limit.to_le_bytes());
        instructions.push(Instruction {
            program_id: self.compute_budget_program,
            accounts: vec![],
            data: limit_data,
        });

        // Index 2: ComputeBudget set_compute_unit_price (discriminator 3)
        let mut price_data = vec![3];
        price_data.extend_from_slice(&cu_price_micro_lamports.to_le_bytes());
        instructions.push(Instruction {
            program_id: self.compute_budget_program,
            accounts: vec![],
            data: price_data,
        });

        // Index 3: Swap instruction
        instructions.push(swap_ix);

        // Index 4: SystemProgram Transfer Tip to Jito Tip Account (discriminator 2 = Transfer)
        let mut transfer_data = vec![2, 0, 0, 0];
        transfer_data.extend_from_slice(&tip_lamports.to_le_bytes());
        instructions.push(Instruction {
            program_id: self.system_program,
            accounts: vec![
                AccountMeta {
                    pubkey: signer,
                    is_signer: true,
                    is_writable: true,
                },
                AccountMeta {
                    pubkey: tip_account,
                    is_signer: false,
                    is_writable: true,
                },
            ],
            data: transfer_data,
        });

        Ok(instructions)
    }

    /// Package instructions into serialized JitoBundle
    pub fn build_jito_bundle(
        &self,
        bundle_id: String,
        swap_ix: Instruction,
        cu_limit: u32,
        cu_price_micro_lamports: u64,
        tip_account: Pubkey,
        tip_lamports: u64,
        signer: Pubkey,
        _blockhash: Blockhash,
    ) -> Result<JitoBundle, ExecutionError> {
        let instructions = self.build_ordered_instructions(
            swap_ix,
            cu_limit,
            cu_price_micro_lamports,
            tip_account,
            tip_lamports,
            signer,
        )?;

        // Deterministic serialization mock representation
        let serialized = serde_json::to_vec(&instructions).map_err(|e| {
            ExecutionError::BundleRejected {
                reason: format!("Failed to serialize bundle instructions: {}", e),
            }
        })?;

        if serialized.len() > SOLANA_MAX_PACKET_SIZE {
            return Err(ExecutionError::BundleSizeLimitExceeded {
                size: serialized.len(),
                max_size: SOLANA_MAX_PACKET_SIZE,
            });
        }

        let bundle = JitoBundle {
            bundle_id,
            serialized_transactions: vec![serialized],
            tip_lamports,
            tip_account,
        };

        if bundle.serialized_transactions.len() > MAX_BUNDLE_TRANSACTIONS {
            return Err(ExecutionError::BundleTransactionCountExceeded {
                count: bundle.serialized_transactions.len(),
                max_count: MAX_BUNDLE_TRANSACTIONS,
            });
        }

        Ok(bundle)
    }

    /// Select tip account in round-robin fashion from available accounts
    pub fn select_round_robin_tip_account(
        tip_accounts: &[Pubkey],
        counter: usize,
    ) -> Result<Pubkey, ExecutionError> {
        if tip_accounts.is_empty() {
            Err(ExecutionError::NoTipAccountsAvailable)
        } else {
            Ok(tip_accounts[counter % tip_accounts.len()])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bundle_builder_strict_index_ordering() {
        let builder = BundleBuilder::new();
        let swap_program = Pubkey::new_unique();
        let swap_ix = Instruction {
            program_id: swap_program,
            accounts: vec![],
            data: vec![1, 2, 3],
        };
        let tip_pk = Pubkey::new_unique();
        let signer = Pubkey::new_unique();

        let ixs = builder
            .build_ordered_instructions(
                swap_ix,
                150_000,
                25_000,
                tip_pk,
                1_000_000,
                signer,
            )
            .unwrap();

        assert_eq!(ixs.len(), 5);
        // Index 0: dont_front
        assert_eq!(ixs[0].accounts[0].pubkey, builder.dont_front_account);
        // Index 1: cu limit
        assert_eq!(ixs[1].program_id, builder.compute_budget_program);
        assert_eq!(ixs[1].data[0], 2);
        // Index 2: cu price
        assert_eq!(ixs[2].program_id, builder.compute_budget_program);
        assert_eq!(ixs[2].data[0], 3);
        // Index 3: swap
        assert_eq!(ixs[3].program_id, swap_program);
        // Index 4: tip
        assert_eq!(ixs[4].program_id, builder.system_program);
        assert_eq!(ixs[4].accounts[1].pubkey, tip_pk);
    }

    #[test]
    fn test_bundle_builder_respects_packet_size_limit() {
        let builder = BundleBuilder::new();
        let swap_program = Pubkey::new_unique();
        let tip_pk = Pubkey::new_unique();
        let signer = Pubkey::new_unique();
        let blockhash = Blockhash::default();

        // 1. Normal size bundle builds successfully
        let small_swap = Instruction {
            program_id: swap_program,
            accounts: vec![],
            data: vec![1, 2, 3, 4],
        };
        let ok_bundle = builder.build_jito_bundle(
            "b1".into(),
            small_swap,
            150_000,
            25_000,
            tip_pk,
            1_000_000,
            signer,
            blockhash,
        );
        assert!(ok_bundle.is_ok());
        let bundle = ok_bundle.unwrap();
        assert!(bundle.serialized_transactions[0].len() <= SOLANA_MAX_PACKET_SIZE);

        // 2. Oversized payload (e.g. 2000 bytes) exceeds 1232 byte limit
        let huge_swap = Instruction {
            program_id: swap_program,
            accounts: vec![],
            data: vec![0u8; 2000],
        };
        let err_bundle = builder.build_jito_bundle(
            "b_huge".into(),
            huge_swap,
            150_000,
            25_000,
            tip_pk,
            1_000_000,
            signer,
            blockhash,
        );
        assert!(matches!(
            err_bundle,
            Err(ExecutionError::BundleSizeLimitExceeded { max_size: 1232, .. })
        ));
    }

    #[test]
    fn test_round_robin_tip_selection() {
        let t1 = Pubkey::new_unique();
        let t2 = Pubkey::new_unique();
        let list = vec![t1, t2];

        assert_eq!(BundleBuilder::select_round_robin_tip_account(&list, 0).unwrap(), t1);
        assert_eq!(BundleBuilder::select_round_robin_tip_account(&list, 1).unwrap(), t2);
        assert_eq!(BundleBuilder::select_round_robin_tip_account(&list, 2).unwrap(), t1);
        assert!(BundleBuilder::select_round_robin_tip_account(&[], 0).is_err());
    }
}
