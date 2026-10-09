use crate::decoder::pump_fun::{PUMP_BUY_DISCRIMINATOR, PUMP_CREATE_DISCRIMINATOR, PUMP_SELL_DISCRIMINATOR};
use crate::decoder::raydium::RAYDIUM_SWAP_BASE_IN_DISCRIMINATOR;
use crate::decoder::token_2022::EXTENSION_TRANSFER_HOOK;
use crate::grpc::transport::{RawInnerInstructionSet, RawInstruction, TransactionUpdateFrame};
use crate::types::{Pubkey, Signature, Slot};
use std::str::FromStr;

pub fn mock_pump_create_tx() -> TransactionUpdateFrame {
    let pump_prog = Pubkey::from_str(crate::decoder::registry::PUMP_FUN_PROGRAM_STR).unwrap();
    let mint = Pubkey::new_unique();
    let curve = Pubkey::new_unique();
    let creator = Pubkey::new_unique();

    let mut data = Vec::new();
    data.extend_from_slice(&PUMP_CREATE_DISCRIMINATOR);
    // Borsh string name: "AlphaToken"
    let name = "AlphaToken";
    data.extend_from_slice(&(name.len() as u32).to_le_bytes());
    data.extend_from_slice(name.as_bytes());
    // symbol: "ALPHA"
    let sym = "ALPHA";
    data.extend_from_slice(&(sym.len() as u32).to_le_bytes());
    data.extend_from_slice(sym.as_bytes());

    let inst = RawInstruction {
        program_id: pump_prog,
        accounts: vec![mint, Pubkey::new_unique(), curve, Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), creator],
        data,
    };

    TransactionUpdateFrame {
        signature: Signature::default(),
        slot: Slot(1000),
        is_vote: false,
        account_keys: vec![creator, mint, curve],
        log_messages: vec![
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]".to_string(),
            "Program log: Instruction: Create".to_string(),
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success".to_string(),
        ],
        err: None,
        instructions: vec![inst],
        inner_instructions: vec![],
    }
}

pub fn mock_pump_buy_direct_tx() -> TransactionUpdateFrame {
    let pump_prog = Pubkey::from_str(crate::decoder::registry::PUMP_FUN_PROGRAM_STR).unwrap();
    let mint = Pubkey::new_unique();
    let curve = Pubkey::new_unique();
    let trader = Pubkey::new_unique();

    let mut data = Vec::new();
    data.extend_from_slice(&PUMP_BUY_DISCRIMINATOR);
    data.extend_from_slice(&10_000_000u64.to_le_bytes()); // 10M tokens
    data.extend_from_slice(&1_500_000_000u64.to_le_bytes()); // 1.5 SOL max cost

    let inst = RawInstruction {
        program_id: pump_prog,
        accounts: vec![mint, curve, Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), trader],
        data,
    };

    TransactionUpdateFrame {
        signature: Signature::default(),
        slot: Slot(1001),
        is_vote: false,
        account_keys: vec![trader, mint, curve],
        log_messages: vec![
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]".to_string(),
            "Program log: Instruction: Buy".to_string(),
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success".to_string(),
        ],
        err: None,
        instructions: vec![inst],
        inner_instructions: vec![],
    }
}

pub fn mock_pump_buy_with_ata_tx() -> TransactionUpdateFrame {
    let mut tx = mock_pump_buy_direct_tx();
    let ata_prog = Pubkey::from_str(crate::decoder::registry::SPL_ATA_PROGRAM_STR).unwrap();

    let ata_inner = RawInstruction {
        program_id: ata_prog,
        accounts: vec![Pubkey::new_unique(), Pubkey::new_unique()],
        data: vec![0x01],
    };

    tx.inner_instructions.push(RawInnerInstructionSet {
        parent_instruction_index: 0,
        instructions: vec![ata_inner],
    });

    tx
}

pub fn mock_pump_sell_tx() -> TransactionUpdateFrame {
    let pump_prog = Pubkey::from_str(crate::decoder::registry::PUMP_FUN_PROGRAM_STR).unwrap();
    let mint = Pubkey::new_unique();
    let curve = Pubkey::new_unique();
    let trader = Pubkey::new_unique();

    let mut data = Vec::new();
    data.extend_from_slice(&PUMP_SELL_DISCRIMINATOR);
    data.extend_from_slice(&5_000_000u64.to_le_bytes()); // 5M tokens
    data.extend_from_slice(&1_200_000_000u64.to_le_bytes()); // 1.2 SOL min output

    let inst = RawInstruction {
        program_id: pump_prog,
        accounts: vec![mint, curve, Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), trader],
        data,
    };

    TransactionUpdateFrame {
        signature: Signature::default(),
        slot: Slot(1002),
        is_vote: false,
        account_keys: vec![trader, mint, curve],
        log_messages: vec![
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]".to_string(),
            "Program log: Instruction: Sell".to_string(),
            "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success".to_string(),
        ],
        err: None,
        instructions: vec![inst],
        inner_instructions: vec![],
    }
}

pub fn mock_raydium_swap_buy_tx() -> TransactionUpdateFrame {
    let raydium_prog = Pubkey::from_str(crate::decoder::registry::RAYDIUM_AMM_V4_STR).unwrap();
    let pool = Pubkey::new_unique();
    let trader = Pubkey::new_unique();

    let mut data = Vec::new();
    data.push(RAYDIUM_SWAP_BASE_IN_DISCRIMINATOR);
    data.extend_from_slice(&2_000_000_000u64.to_le_bytes()); // 2.0 SOL in
    data.extend_from_slice(&15_000_000u64.to_le_bytes()); // 15M tokens out

    let mut accounts = vec![Pubkey::new_unique(); 19];
    accounts[1] = pool;
    accounts[17] = trader;

    let inst = RawInstruction {
        program_id: raydium_prog,
        accounts,
        data,
    };

    TransactionUpdateFrame {
        signature: Signature::default(),
        slot: Slot(1003),
        is_vote: false,
        account_keys: vec![trader, pool],
        log_messages: vec![
            "Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]".to_string(),
            "Program log: Instruction: Swap".to_string(),
            "Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 success".to_string(),
        ],
        err: None,
        instructions: vec![inst],
        inner_instructions: vec![],
    }
}

pub fn mock_failed_tx() -> TransactionUpdateFrame {
    let mut tx = mock_pump_buy_direct_tx();
    tx.err = Some("InstructionError(0, Custom(6001))".to_string());
    tx.log_messages.push("Program failed to complete".to_string());
    tx
}

pub fn mock_token_2022_mint_with_transfer_hook_bytes() -> Vec<u8> {
    let mut bytes = vec![0u8; 82]; // standard 82-byte mint header
    bytes.push(1); // AccountType::Mint

    // Extension: TransferHook (type = 14, len = 64)
    bytes.extend_from_slice(&EXTENSION_TRANSFER_HOOK.to_le_bytes());
    bytes.extend_from_slice(&64u16.to_le_bytes());
    bytes.extend_from_slice(&vec![0xdd; 64]);

    bytes
}

pub fn mock_unknown_program_tx() -> TransactionUpdateFrame {
    let unknown_prog = Pubkey::new_unique();
    let inst = RawInstruction {
        program_id: unknown_prog,
        accounts: vec![Pubkey::new_unique()],
        data: vec![0x99, 0x88, 0x77],
    };

    TransactionUpdateFrame {
        signature: Signature::default(),
        slot: Slot(1004),
        is_vote: false,
        account_keys: vec![Pubkey::new_unique()],
        log_messages: vec!["Program Unknown invoke [1]".to_string()],
        err: None,
        instructions: vec![inst],
        inner_instructions: vec![],
    }
}
