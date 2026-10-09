use serde::{Deserialize, Serialize};

pub const EXTENSION_TRANSFER_FEE: u16 = 1;
pub const EXTENSION_DEFAULT_ACCOUNT_STATE: u16 = 6;
pub const EXTENSION_NON_TRANSFERABLE: u16 = 9;
pub const EXTENSION_PERMANENT_DELEGATE: u16 = 12;
pub const EXTENSION_TRANSFER_HOOK: u16 = 14;

/// Result of parsing Token-2022 extensions on a mint account
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Token2022RiskInspection {
    pub is_token_2022: bool,
    pub has_transfer_hook: bool,
    pub has_permanent_delegate: bool,
    pub has_transfer_fee: bool,
    pub is_non_transferable: bool,
    pub is_dangerous: bool,
    pub detected_extensions: Vec<u16>,
    pub veto_reasons: Vec<String>,
}

pub struct Token2022Parser;

impl Token2022Parser {
    /// Inspect raw bytes of an SPL Mint account to detect malicious or restrictive extensions
    pub fn inspect_mint_data(data: &[u8]) -> Token2022RiskInspection {
        let mut inspection = Token2022RiskInspection::default();

        // Standard SPL Mint is 82 bytes. Token-2022 with extensions is > 82 bytes
        if data.len() <= 82 {
            return inspection;
        }

        inspection.is_token_2022 = true;

        // Skip standard mint header (82 bytes)
        let mut offset = 82;

        // Optional AccountType byte exists in Token-2022 (offset 82)
        if offset < data.len() && data[offset] == 1 {
            offset += 1;
        }

        // Parse TLV extension entries: [type: u16 LE] [length: u16 LE] [data]
        while offset + 4 <= data.len() {
            let ext_type = u16::from_le_bytes([data[offset], data[offset + 1]]);
            let ext_len = u16::from_le_bytes([data[offset + 2], data[offset + 3]]) as usize;
            offset += 4;

            if offset + ext_len > data.len() {
                break; // Corrupted or truncated extension buffer
            }

            inspection.detected_extensions.push(ext_type);

            match ext_type {
                EXTENSION_TRANSFER_HOOK => {
                    inspection.has_transfer_hook = true;
                    inspection.is_dangerous = true;
                    inspection.veto_reasons.push(
                        "Token-2022 TransferHook extension detected: transfers can be frozen or taxed dynamically".to_string(),
                    );
                }
                EXTENSION_PERMANENT_DELEGATE => {
                    inspection.has_permanent_delegate = true;
                    inspection.is_dangerous = true;
                    inspection.veto_reasons.push(
                        "Token-2022 PermanentDelegate detected: issuer can confiscate or burn user tokens".to_string(),
                    );
                }
                EXTENSION_NON_TRANSFERABLE => {
                    inspection.is_non_transferable = true;
                    inspection.is_dangerous = true;
                    inspection.veto_reasons.push(
                        "Token-2022 NonTransferable detected: tokens cannot be sold or transferred".to_string(),
                    );
                }
                EXTENSION_TRANSFER_FEE => {
                    inspection.has_transfer_fee = true;
                }
                _ => {}
            }

            offset += ext_len;
        }

        inspection
    }
}
