use crate::types::Pubkey;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

pub const PUMP_FUN_PROGRAM_STR: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
pub const RAYDIUM_AMM_V4_STR: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
pub const TOKEN_2022_PROGRAM_STR: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
pub const SPL_TOKEN_PROGRAM_STR: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const SPL_ATA_PROGRAM_STR: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
pub const SYSTEM_PROGRAM_STR: &str = "11111111111111111111111111111111";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KnownProgram {
    PumpFun,
    RaydiumAmmV4,
    Token2022,
    SplToken,
    AssociatedTokenAccount,
    SystemProgram,
    CustomRouter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgramRegistration {
    pub program_type: KnownProgram,
    pub decoder_version: u32,
    pub name: String,
    pub enabled: bool,
}

/// Registry mapping Solana program IDs to supported decoders and version specifications
#[derive(Debug, Clone)]
pub struct ProgramRegistry {
    entries: HashMap<Pubkey, ProgramRegistration>,
    pub pump_fun_pubkey: Pubkey,
    pub raydium_v4_pubkey: Pubkey,
    pub token_2022_pubkey: Pubkey,
    pub spl_token_pubkey: Pubkey,
    pub spl_ata_pubkey: Pubkey,
    pub system_pubkey: Pubkey,
}

impl Default for ProgramRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProgramRegistry {
    pub fn new() -> Self {
        let pump_fun = Pubkey::from_str(PUMP_FUN_PROGRAM_STR).expect("Valid Pump.fun pubkey");
        let raydium_v4 = Pubkey::from_str(RAYDIUM_AMM_V4_STR).expect("Valid Raydium AMM pubkey");
        let token_2022 = Pubkey::from_str(TOKEN_2022_PROGRAM_STR).expect("Valid Token-2022 pubkey");
        let spl_token = Pubkey::from_str(SPL_TOKEN_PROGRAM_STR).expect("Valid SPL Token pubkey");
        let spl_ata = Pubkey::from_str(SPL_ATA_PROGRAM_STR).expect("Valid SPL ATA pubkey");
        let system = Pubkey::from_str(SYSTEM_PROGRAM_STR).expect("Valid System pubkey");

        let mut reg = Self {
            entries: HashMap::new(),
            pump_fun_pubkey: pump_fun,
            raydium_v4_pubkey: raydium_v4,
            token_2022_pubkey: token_2022,
            spl_token_pubkey: spl_token,
            spl_ata_pubkey: spl_ata,
            system_pubkey: system,
        };

        reg.register(
            pump_fun,
            ProgramRegistration {
                program_type: KnownProgram::PumpFun,
                decoder_version: 1,
                name: "Pump.fun Bonding Curve".to_string(),
                enabled: true,
            },
        );

        reg.register(
            raydium_v4,
            ProgramRegistration {
                program_type: KnownProgram::RaydiumAmmV4,
                decoder_version: 4,
                name: "Raydium AMM v4".to_string(),
                enabled: true,
            },
        );

        reg.register(
            token_2022,
            ProgramRegistration {
                program_type: KnownProgram::Token2022,
                decoder_version: 1,
                name: "SPL Token Extensions (Token-2022)".to_string(),
                enabled: true,
            },
        );

        reg.register(
            spl_token,
            ProgramRegistration {
                program_type: KnownProgram::SplToken,
                decoder_version: 1,
                name: "SPL Token Program".to_string(),
                enabled: true,
            },
        );

        reg.register(
            spl_ata,
            ProgramRegistration {
                program_type: KnownProgram::AssociatedTokenAccount,
                decoder_version: 1,
                name: "Associated Token Account Program".to_string(),
                enabled: true,
            },
        );

        reg.register(
            system,
            ProgramRegistration {
                program_type: KnownProgram::SystemProgram,
                decoder_version: 1,
                name: "System Program".to_string(),
                enabled: true,
            },
        );

        reg
    }

    pub fn register(&mut self, pubkey: Pubkey, registration: ProgramRegistration) {
        self.entries.insert(pubkey, registration);
    }

    pub fn get(&self, pubkey: &Pubkey) -> Option<&ProgramRegistration> {
        self.entries.get(pubkey)
    }

    pub fn classify(&self, pubkey: &Pubkey) -> Option<KnownProgram> {
        self.entries.get(pubkey).and_then(|r| {
            if r.enabled {
                Some(r.program_type)
            } else {
                None
            }
        })
    }

    pub fn is_monitored(&self, pubkey: &Pubkey) -> bool {
        self.entries.get(pubkey).map(|r| r.enabled).unwrap_or(false)
    }
}
