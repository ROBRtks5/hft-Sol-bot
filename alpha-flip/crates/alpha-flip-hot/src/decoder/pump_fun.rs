use crate::events::TradeSide;
use crate::grpc::transport::{RawInnerInstructionSet, RawInstruction};
use crate::types::{Lamports, Mint, Pubkey, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};

/// 8-byte Anchor discriminators for Pump.fun instructions
pub const PUMP_CREATE_DISCRIMINATOR: [u8; 8] = [0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77];
pub const PUMP_BUY_DISCRIMINATOR: [u8; 8] = [0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea];
pub const PUMP_SELL_DISCRIMINATOR: [u8; 8] = [0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad];
pub const PUMP_MIGRATE_DISCRIMINATOR: [u8; 8] = [0xb7, 0x12, 0x45, 0x4c, 0x4d, 0x07, 0x4d, 0xd4];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PumpCreateDecoded {
    pub mint: Mint,
    pub bonding_curve: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub slot: Slot,
    pub signature: Signature,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PumpTradeDecoded {
    pub mint: Mint,
    pub bonding_curve: Pubkey,
    pub trader: Pubkey,
    pub side: TradeSide,
    pub token_amount: TokenAmount,
    pub sol_amount: Lamports,
    pub has_ata_creation: bool,
    pub slot: Slot,
    pub signature: Signature,
    pub is_direct: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PumpMigrateDecoded {
    pub mint: Mint,
    pub bonding_curve: Pubkey,
    pub slot: Slot,
    pub signature: Signature,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PumpInstructionDecoded {
    Create(PumpCreateDecoded),
    Trade(PumpTradeDecoded),
    Migrate(PumpMigrateDecoded),
    Unknown([u8; 8]),
}

pub struct PumpFunDecoder;

impl PumpFunDecoder {
    /// Decode a Pump.fun instruction from binary instruction data and account addresses
    pub fn decode_instruction(
        instruction: &RawInstruction,
        inner_instructions: &[RawInnerInstructionSet],
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<PumpInstructionDecoded> {
        if instruction.data.len() < 8 {
            return None;
        }

        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&instruction.data[..8]);

        match discriminator {
            PUMP_BUY_DISCRIMINATOR => {
                Self::decode_buy(instruction, inner_instructions, slot, signature, signer_fallback)
                    .map(PumpInstructionDecoded::Trade)
            }
            PUMP_SELL_DISCRIMINATOR => {
                Self::decode_sell(instruction, inner_instructions, slot, signature, signer_fallback)
                    .map(PumpInstructionDecoded::Trade)
            }
            PUMP_CREATE_DISCRIMINATOR => {
                Self::decode_create(instruction, slot, signature, signer_fallback)
                    .map(PumpInstructionDecoded::Create)
            }
            PUMP_MIGRATE_DISCRIMINATOR => {
                Self::decode_migrate(instruction, slot, signature)
                    .map(PumpInstructionDecoded::Migrate)
            }
            other => Some(PumpInstructionDecoded::Unknown(other)),
        }
    }

    fn decode_buy(
        inst: &RawInstruction,
        inner_instructions: &[RawInnerInstructionSet],
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<PumpTradeDecoded> {
        // Accounts: [0: mint, 1: bonding_curve, 2: assoc_bonding_curve, 3: assoc_user, 4: user (trader)]
        if inst.accounts.is_empty() || inst.data.len() < 24 {
            return None;
        }

        let mint = inst.accounts[0];
        let bonding_curve = if inst.accounts.len() > 1 {
            inst.accounts[1]
        } else {
            Pubkey::default()
        };

        let trader = if inst.accounts.len() > 6 {
            inst.accounts[6] // standard Pump.fun layout: user is account 6
        } else if inst.accounts.len() > 4 {
            inst.accounts[4]
        } else {
            signer_fallback.unwrap_or_default()
        };

        // Data layout: [0..8: disc, 8..16: token_amount (u64 LE), 16..24: max_sol_cost (u64 LE)]
        let token_amount = u64::from_le_bytes(inst.data[8..16].try_into().ok()?);
        let sol_amount = u64::from_le_bytes(inst.data[16..24].try_into().ok()?);

        // Check if inner instructions contain Associated Token Account creation
        let has_ata_creation = inner_instructions.iter().any(|set| {
            set.instructions.iter().any(|inner| {
                // ATA program: ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
                inner.program_id.to_string() == crate::decoder::registry::SPL_ATA_PROGRAM_STR
            })
        });

        Some(PumpTradeDecoded {
            mint,
            bonding_curve,
            trader,
            side: TradeSide::Buy,
            token_amount: TokenAmount(token_amount),
            sol_amount: Lamports(sol_amount),
            has_ata_creation,
            slot,
            signature,
            is_direct: true,
        })
    }

    fn decode_sell(
        inst: &RawInstruction,
        _inner_instructions: &[RawInnerInstructionSet],
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<PumpTradeDecoded> {
        if inst.accounts.is_empty() || inst.data.len() < 24 {
            return None;
        }

        let mint = inst.accounts[0];
        let bonding_curve = if inst.accounts.len() > 1 {
            inst.accounts[1]
        } else {
            Pubkey::default()
        };

        let trader = if inst.accounts.len() > 6 {
            inst.accounts[6]
        } else if inst.accounts.len() > 4 {
            inst.accounts[4]
        } else {
            signer_fallback.unwrap_or_default()
        };

        // Data layout: [0..8: disc, 8..16: token_amount (u64 LE), 16..24: min_sol_output (u64 LE)]
        let token_amount = u64::from_le_bytes(inst.data[8..16].try_into().ok()?);
        let sol_amount = u64::from_le_bytes(inst.data[16..24].try_into().ok()?);

        Some(PumpTradeDecoded {
            mint,
            bonding_curve,
            trader,
            side: TradeSide::Sell,
            token_amount: TokenAmount(token_amount),
            sol_amount: Lamports(sol_amount),
            has_ata_creation: false,
            slot,
            signature,
            is_direct: true,
        })
    }

    fn decode_create(
        inst: &RawInstruction,
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<PumpCreateDecoded> {
        if inst.accounts.len() < 3 {
            return None;
        }

        let mint = inst.accounts[0];
        let bonding_curve = inst.accounts[2];
        let creator = if inst.accounts.len() > 7 {
            inst.accounts[7]
        } else {
            signer_fallback.unwrap_or_default()
        };

        // Extract string metadata if available
        let mut name = String::new();
        let mut symbol = String::new();
        let mut uri = String::new();

        if inst.data.len() > 16 {
            // Anchor Borsh String: [4-byte length LE] + bytes
            let mut offset = 8;
            if let Some((n, next)) = Self::read_borsh_string(&inst.data, offset) {
                name = n;
                offset = next;
                if let Some((s, next_s)) = Self::read_borsh_string(&inst.data, offset) {
                    symbol = s;
                    offset = next_s;
                    if let Some((u, _)) = Self::read_borsh_string(&inst.data, offset) {
                        uri = u;
                    }
                }
            }
        }

        Some(PumpCreateDecoded {
            mint,
            bonding_curve,
            creator,
            name,
            symbol,
            uri,
            slot,
            signature,
        })
    }

    fn decode_migrate(
        inst: &RawInstruction,
        slot: Slot,
        signature: Signature,
    ) -> Option<PumpMigrateDecoded> {
        if inst.accounts.len() < 2 {
            return None;
        }
        Some(PumpMigrateDecoded {
            mint: inst.accounts[0],
            bonding_curve: inst.accounts[1],
            slot,
            signature,
        })
    }

    fn read_borsh_string(data: &[u8], offset: usize) -> Option<(String, usize)> {
        if offset + 4 > data.len() {
            return None;
        }
        let len = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?) as usize;
        let start = offset + 4;
        let end = start + len;
        if end > data.len() {
            return None;
        }
        let s = String::from_utf8_lossy(&data[start..end]).to_string();
        Some((s, end))
    }
}
