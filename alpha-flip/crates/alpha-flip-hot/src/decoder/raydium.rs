use crate::events::TradeSide;
use crate::grpc::transport::RawInstruction;
use crate::types::{Lamports, Mint, Pubkey, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};

pub const RAYDIUM_INIT2_DISCRIMINATOR: u8 = 0x01;
pub const RAYDIUM_DEPOSIT_DISCRIMINATOR: u8 = 0x03;
pub const RAYDIUM_WITHDRAW_DISCRIMINATOR: u8 = 0x04;
pub const RAYDIUM_SWAP_BASE_IN_DISCRIMINATOR: u8 = 0x09;
pub const RAYDIUM_SWAP_BASE_OUT_DISCRIMINATOR: u8 = 0x0b;

pub const WSOL_MINT_STR: &str = "So11111111111111111111111111111111111111112";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RaydiumPoolCreatedDecoded {
    pub pool: Pubkey,
    pub coin_mint: Mint,
    pub pc_mint: Mint,
    pub open_time: u64,
    pub slot: Slot,
    pub signature: Signature,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RaydiumSwapDecoded {
    pub pool: Pubkey,
    pub mint: Mint,
    pub trader: Pubkey,
    pub side: TradeSide,
    pub input_amount: u64,
    pub output_amount: u64,
    pub sol_amount: Lamports,
    pub token_amount: TokenAmount,
    pub slot: Slot,
    pub signature: Signature,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RaydiumInstructionDecoded {
    PoolCreated(RaydiumPoolCreatedDecoded),
    Swap(RaydiumSwapDecoded),
    LiquidityChange { pool: Pubkey, is_add: bool },
    Unknown(u8),
}

pub struct RaydiumDecoder;

impl RaydiumDecoder {
    pub fn decode_instruction(
        instruction: &RawInstruction,
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<RaydiumInstructionDecoded> {
        if instruction.data.is_empty() {
            return None;
        }

        let discriminator = instruction.data[0];

        match discriminator {
            RAYDIUM_SWAP_BASE_IN_DISCRIMINATOR => {
                Self::decode_swap_base_in(instruction, slot, signature, signer_fallback)
                    .map(RaydiumInstructionDecoded::Swap)
            }
            RAYDIUM_SWAP_BASE_OUT_DISCRIMINATOR => {
                Self::decode_swap_base_out(instruction, slot, signature, signer_fallback)
                    .map(RaydiumInstructionDecoded::Swap)
            }
            RAYDIUM_INIT2_DISCRIMINATOR => {
                Self::decode_init2(instruction, slot, signature)
                    .map(RaydiumInstructionDecoded::PoolCreated)
            }
            RAYDIUM_DEPOSIT_DISCRIMINATOR => {
                let pool = instruction.accounts.get(1).copied().unwrap_or_default();
                Some(RaydiumInstructionDecoded::LiquidityChange { pool, is_add: true })
            }
            RAYDIUM_WITHDRAW_DISCRIMINATOR => {
                let pool = instruction.accounts.get(1).copied().unwrap_or_default();
                Some(RaydiumInstructionDecoded::LiquidityChange { pool, is_add: false })
            }
            other => Some(RaydiumInstructionDecoded::Unknown(other)),
        }
    }

    fn decode_swap_base_in(
        inst: &RawInstruction,
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<RaydiumSwapDecoded> {
        if inst.accounts.len() < 17 || inst.data.len() < 17 {
            return None;
        }

        let pool = inst.accounts[1];
        let trader = if inst.accounts.len() > 17 {
            inst.accounts[17]
        } else {
            signer_fallback.unwrap_or_default()
        };

        // Raydium layout: [0: disc, 1..9: amount_in (u64 LE), 9..17: min_out (u64 LE)]
        let amount_in = u64::from_le_bytes(inst.data[1..9].try_into().ok()?);
        let min_out = u64::from_le_bytes(inst.data[9..17].try_into().ok()?);

        // Account 5 is coin vault, account 6 is pc vault
        // We identify the non-WSOL token mint from pool accounts
        let coin_vault = inst.accounts.get(4).copied().unwrap_or_default();
        let pc_vault = inst.accounts.get(5).copied().unwrap_or_default();

        // Heuristic: If source token matches WSOL, this is a BUY
        // Default to Coin Vault token as target mint
        let mint = coin_vault;
        let side = TradeSide::Buy;

        Some(RaydiumSwapDecoded {
            pool,
            mint,
            trader,
            side,
            input_amount: amount_in,
            output_amount: min_out,
            sol_amount: Lamports(amount_in),
            token_amount: TokenAmount(min_out),
            slot,
            signature,
        })
    }

    fn decode_swap_base_out(
        inst: &RawInstruction,
        slot: Slot,
        signature: Signature,
        signer_fallback: Option<Pubkey>,
    ) -> Option<RaydiumSwapDecoded> {
        if inst.accounts.len() < 17 || inst.data.len() < 17 {
            return None;
        }

        let pool = inst.accounts[1];
        let trader = if inst.accounts.len() > 17 {
            inst.accounts[17]
        } else {
            signer_fallback.unwrap_or_default()
        };

        let max_in = u64::from_le_bytes(inst.data[1..9].try_into().ok()?);
        let amount_out = u64::from_le_bytes(inst.data[9..17].try_into().ok()?);

        Some(RaydiumSwapDecoded {
            pool,
            mint: inst.accounts.get(4).copied().unwrap_or_default(),
            trader,
            side: TradeSide::Sell,
            input_amount: max_in,
            output_amount: amount_out,
            sol_amount: Lamports(amount_out),
            token_amount: TokenAmount(max_in),
            slot,
            signature,
        })
    }

    fn decode_init2(
        inst: &RawInstruction,
        slot: Slot,
        signature: Signature,
    ) -> Option<RaydiumPoolCreatedDecoded> {
        if inst.accounts.len() < 10 {
            return None;
        }

        let pool = inst.accounts[4];
        let coin_mint = inst.accounts[8];
        let pc_mint = inst.accounts[9];

        let open_time = if inst.data.len() >= 9 {
            u64::from_le_bytes(inst.data[1..9].try_into().unwrap_or_default())
        } else {
            0
        };

        Some(RaydiumPoolCreatedDecoded {
            pool,
            coin_mint,
            pc_mint,
            open_time,
            slot,
            signature,
        })
    }
}
