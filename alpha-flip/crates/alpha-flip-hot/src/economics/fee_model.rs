use serde::{Deserialize, Serialize};

pub const BASE_SOLANA_SIGNATURE_FEE: u64 = 5_000;
pub const RENT_EXEMPT_ATA_LAMPORTS: u64 = 2_039_280;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JitoTipTier {
    Normal,
    Fast,
    Aggressive,
}

impl JitoTipTier {
    pub fn tip_lamports(&self) -> u64 {
        match self {
            JitoTipTier::Normal => 1_000_000,     // 0.001 SOL
            JitoTipTier::Fast => 2_500_000,       // 0.0025 SOL
            JitoTipTier::Aggressive => 5_000_000, // 0.005 SOL
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DexProtocol {
    PumpFun,
    Raydium,
}

impl DexProtocol {
    pub fn swap_fee_bps(&self) -> u16 {
        match self {
            DexProtocol::PumpFun => 100, // 1.0%
            DexProtocol::Raydium => 25,  // 0.25%
        }
    }
}

#[derive(Debug, Clone)]
pub struct FeeModel {
    pub base_network_fee: u64,
    pub priority_fee_lamports: u64,
    pub jito_tip_tier: JitoTipTier,
    pub ata_creation_cost: u64,
}

impl Default for FeeModel {
    fn default() -> Self {
        Self {
            base_network_fee: BASE_SOLANA_SIGNATURE_FEE,
            priority_fee_lamports: 50_000,
            jito_tip_tier: JitoTipTier::Normal,
            ata_creation_cost: RENT_EXEMPT_ATA_LAMPORTS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoundtripFeeEstimate {
    pub buy_network_fee: u64,
    pub buy_priority_fee: u64,
    pub buy_jito_tip: u64,
    pub buy_ata_rent: u64,
    pub buy_dex_fee_lamports: u64,

    pub sell_network_fee: u64,
    pub sell_priority_fee: u64,
    pub sell_jito_tip: u64,
    pub sell_dex_fee_lamports: u64,

    pub total_fee_lamports: u64,
    pub total_cost_bps: u16,
}

impl FeeModel {
    pub fn new(priority_fee_lamports: u64, jito_tier: JitoTipTier) -> Self {
        Self {
            base_network_fee: BASE_SOLANA_SIGNATURE_FEE,
            priority_fee_lamports,
            jito_tip_tier: jito_tier,
            ata_creation_cost: RENT_EXEMPT_ATA_LAMPORTS,
        }
    }

    /// Estimate total roundtrip friction (buy + sell)
    pub fn estimate_roundtrip(
        &self,
        dex: DexProtocol,
        position_lamports: u64,
        needs_ata_creation: bool,
    ) -> RoundtripFeeEstimate {
        let jito_tip = self.jito_tip_tier.tip_lamports();
        let dex_bps = dex.swap_fee_bps();

        // 1. Buy leg costs
        let buy_dex_fee = ((position_lamports as u128 * dex_bps as u128) / 10_000) as u64;
        let buy_ata_rent = if needs_ata_creation {
            self.ata_creation_cost
        } else {
            0
        };

        // 2. Sell leg costs
        let sell_dex_fee = ((position_lamports as u128 * dex_bps as u128) / 10_000) as u64;

        let total_fee_lamports = self.base_network_fee
            + self.priority_fee_lamports
            + jito_tip
            + buy_ata_rent
            + buy_dex_fee
            + self.base_network_fee
            + self.priority_fee_lamports
            + jito_tip
            + sell_dex_fee;

        let total_cost_bps = if position_lamports > 0 {
            let bps = ((total_fee_lamports as u128 * 10_000) / position_lamports as u128) as u64;
            if bps > u16::MAX as u64 {
                u16::MAX
            } else {
                bps as u16
            }
        } else {
            u16::MAX
        };

        RoundtripFeeEstimate {
            buy_network_fee: self.base_network_fee,
            buy_priority_fee: self.priority_fee_lamports,
            buy_jito_tip: jito_tip,
            buy_ata_rent,
            buy_dex_fee_lamports: buy_dex_fee,
            sell_network_fee: self.base_network_fee,
            sell_priority_fee: self.priority_fee_lamports,
            sell_jito_tip: jito_tip,
            sell_dex_fee_lamports: sell_dex_fee,
            total_fee_lamports,
            total_cost_bps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_fee_calculation() {
        let model = FeeModel::default();
        let position = 1_000_000_000; // 1 SOL

        let fees = model.estimate_roundtrip(DexProtocol::PumpFun, position, false);

        // 2x base (10k) + 2x priority (100k) + 2x jito (2M) + 2x 1% dex (20M) = ~22.11M lamports
        assert_eq!(fees.buy_dex_fee_lamports, 10_000_000);
        assert_eq!(fees.sell_dex_fee_lamports, 10_000_000);
        assert_eq!(fees.buy_jito_tip, 1_000_000);
        assert_eq!(fees.sell_jito_tip, 1_000_000);
        assert_eq!(fees.buy_ata_rent, 0);

        let expected_total = 5_000 * 2 + 50_000 * 2 + 1_000_000 * 2 + 20_000_000;
        assert_eq!(fees.total_fee_lamports, expected_total);
        assert!(fees.total_cost_bps > 200); // > 2.2% of 1 SOL
    }

    #[test]
    fn test_roundtrip_fee_with_ata() {
        let model = FeeModel::default();
        let fees = model.estimate_roundtrip(DexProtocol::PumpFun, 1_000_000_000, true);
        assert_eq!(fees.buy_ata_rent, RENT_EXEMPT_ATA_LAMPORTS);
    }
}
