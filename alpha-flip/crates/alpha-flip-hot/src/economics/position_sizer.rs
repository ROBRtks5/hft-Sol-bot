use crate::errors::EconomicError;
use crate::AdvisoryAction;

#[derive(Debug, Clone)]
pub struct PositionSizer {
    pub max_position_lamports: u64,
    pub min_trade_size_lamports: u64,
    pub max_pool_reserve_pct: f64,
}

impl Default for PositionSizer {
    fn default() -> Self {
        Self {
            max_position_lamports: 1_500_000_000, // 1.5 SOL
            min_trade_size_lamports: 50_000_000,  // 0.05 SOL
            max_pool_reserve_pct: 2.0,             // 2.0% of pool reserve
        }
    }
}

#[derive(Debug, Clone)]
pub struct SizingContext {
    pub base_target_lamports: u64,
    pub pool_sol_reserves_lamports: u64,
    pub cabal_score: u8,
    pub has_smart_money: bool,
    pub dev_proxy_risk_flag: bool,
    pub cold_advisory: Option<AdvisoryAction>,
}

impl PositionSizer {
    pub fn new(
        max_position_lamports: u64,
        min_trade_size_lamports: u64,
        max_pool_reserve_pct: f64,
    ) -> Self {
        Self {
            max_position_lamports,
            min_trade_size_lamports,
            max_pool_reserve_pct,
        }
    }

    /// Computes risk-adjusted, liquidity-capped position size in lamports
    pub fn size_position(&self, ctx: &SizingContext) -> Result<u64, EconomicError> {
        // 1. Cold advisory check (Advisory can veto or downscale, NEVER increase risk)
        if let Some(advisory) = ctx.cold_advisory {
            if advisory == AdvisoryAction::Veto {
                return Err(EconomicError::AdvisoryVeto {
                    reason: "Cold path narrative/cabal intelligence issued VETO".to_string(),
                });
            }
        }

        // 2. Initial candidate clamped to hard position cap
        let mut candidate = ctx.base_target_lamports.min(self.max_position_lamports);

        // 3. Pool liquidity cap check
        let liquidity_cap = (ctx.pool_sol_reserves_lamports as f64
            * (self.max_pool_reserve_pct / 100.0)) as u64;

        if candidate > liquidity_cap {
            candidate = liquidity_cap;
        }

        // 4. Risk-adjusted multiplier
        let mut multiplier: f64 = 1.0;

        // Cabal score tiering
        if ctx.cabal_score >= 80 {
            return Err(EconomicError::AdvisoryVeto {
                reason: format!("Cabal risk score {} exceeds threshold 80", ctx.cabal_score),
            });
        } else if ctx.cabal_score >= 60 {
            multiplier *= 0.50;
        } else if ctx.cabal_score >= 40 {
            multiplier *= 0.75;
        }

        // Dev risk penalty
        if ctx.dev_proxy_risk_flag {
            multiplier *= 0.70;
        }

        // Smart money signal slight positive adjustment
        if ctx.has_smart_money {
            multiplier = (multiplier * 1.15).min(1.0);
        }

        // Cold advisory downscaling
        if let Some(AdvisoryAction::Downsize) = ctx.cold_advisory {
            multiplier *= 0.50;
        }

        let sized_lamports = (candidate as f64 * multiplier) as u64;
        let final_lamports = sized_lamports
            .min(self.max_position_lamports)
            .min(liquidity_cap);

        // 5. Floor constraint check
        if final_lamports < self.min_trade_size_lamports {
            return Err(EconomicError::SizeBelowMinimumFloor {
                size_lamports: final_lamports,
                min_lamports: self.min_trade_size_lamports,
            });
        }

        Ok(final_lamports)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_sizer_standard() {
        let sizer = PositionSizer::default();
        let ctx = SizingContext {
            base_target_lamports: 1_000_000_000,      // 1.0 SOL
            pool_sol_reserves_lamports: 40_000_000_000, // 40 SOL (2% = 0.8 SOL)
            cabal_score: 20,
            has_smart_money: true,
            dev_proxy_risk_flag: false,
            cold_advisory: Some(AdvisoryAction::Neutral),
        };

        let size = sizer.size_position(&ctx).unwrap();
        // 2% of 40 SOL is 800_000_000 lamports
        assert_eq!(size, 800_000_000);
    }

    #[test]
    fn test_position_sizer_cabal_downscale() {
        let sizer = PositionSizer::default();
        let ctx = SizingContext {
            base_target_lamports: 1_000_000_000,
            pool_sol_reserves_lamports: 100_000_000_000, // 100 SOL (2% = 2 SOL > 1 SOL target)
            cabal_score: 65,                             // 50% penalty
            has_smart_money: false,
            dev_proxy_risk_flag: false,
            cold_advisory: None,
        };

        let size = sizer.size_position(&ctx).unwrap();
        assert_eq!(size, 500_000_000); // 1.0 SOL * 0.5 = 0.5 SOL
    }

    #[test]
    fn test_position_sizer_floor_rejection() {
        let sizer = PositionSizer::default();
        let ctx = SizingContext {
            base_target_lamports: 60_000_000, // 0.06 SOL
            pool_sol_reserves_lamports: 100_000_000_000,
            cabal_score: 65,                  // downscales to 0.03 SOL (< 0.05 SOL floor)
            has_smart_money: false,
            dev_proxy_risk_flag: false,
            cold_advisory: None,
        };

        let res = sizer.size_position(&ctx);
        assert!(matches!(res, Err(EconomicError::SizeBelowMinimumFloor { .. })));
    }

    #[test]
    fn test_position_sizer_cold_advisory_veto() {
        let sizer = PositionSizer::default();
        let ctx = SizingContext {
            base_target_lamports: 1_000_000_000,
            pool_sol_reserves_lamports: 100_000_000_000,
            cabal_score: 10,
            has_smart_money: true,
            dev_proxy_risk_flag: false,
            cold_advisory: Some(AdvisoryAction::Veto),
        };

        let res = sizer.size_position(&ctx);
        assert!(matches!(res, Err(EconomicError::AdvisoryVeto { .. })));
    }
}
