use crate::decoder::registry::{KnownProgram, ProgramRegistry};
use crate::grpc::transport::{RawInnerInstructionSet, RawInstruction};
use crate::types::Pubkey;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedInnerInstruction {
    pub parent_index: u8,
    pub target_program: KnownProgram,
    pub instruction: RawInstruction,
    pub real_signer: Option<Pubkey>,
    pub is_ambiguous: bool,
}

pub struct InnerInstructionSelector;

impl InnerInstructionSelector {
    /// Selectively filter inner instructions targeting monitored DEX programs
    pub fn select_relevant_cpi(
        inner_instruction_sets: &[RawInnerInstructionSet],
        account_keys: &[Pubkey],
        registry: &ProgramRegistry,
    ) -> Vec<SelectedInnerInstruction> {
        let mut selected = Vec::new();

        // Identify transaction fee payer / primary signer (account 0 in Solana standard tx)
        let primary_signer = account_keys.first().copied();

        for set in inner_instruction_sets {
            for inner in &set.instructions {
                if let Some(known) = registry.classify(&inner.program_id) {
                    match known {
                        KnownProgram::PumpFun | KnownProgram::RaydiumAmmV4 => {
                            // Resolve actual trader signer
                            let (signer, ambiguous) =
                                Self::resolve_signer(inner, primary_signer, account_keys);

                            selected.push(SelectedInnerInstruction {
                                parent_index: set.parent_instruction_index,
                                target_program: known,
                                instruction: inner.clone(),
                                real_signer: signer,
                                is_ambiguous: ambiguous,
                            });
                        }
                        // Non-relevant programs (e.g. compute budget, system transfer) are pruned
                        _ => {}
                    }
                }
            }
        }

        selected
    }

    /// Resolve actual trader signer vs router/relayer PDA
    fn resolve_signer(
        inst: &RawInstruction,
        primary_signer: Option<Pubkey>,
        _account_keys: &[Pubkey],
    ) -> (Option<Pubkey>, bool) {
        // In Pump.fun: user is usually account index 6 or 4
        if inst.accounts.len() > 6 {
            let candidate = inst.accounts[6];
            return (Some(candidate), false);
        } else if inst.accounts.len() > 4 {
            let candidate = inst.accounts[4];
            return (Some(candidate), false);
        }

        // Fallback to top-level fee payer if single signer
        if let Some(payer) = primary_signer {
            (Some(payer), false)
        } else {
            // Ambiguous router context: cannot identify real signer safely
            (None, true)
        }
    }
}
