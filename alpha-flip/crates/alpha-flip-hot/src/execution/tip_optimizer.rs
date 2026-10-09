use crate::errors::ExecutionError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MarketRegime {
    Quiet,
    Normal,
    Hot,
    MevWar,
    LiquidityDry,
}

#[derive(Debug, Clone)]
pub struct TipOptimizer {
    pub regime: MarketRegime,
    pub target_landed_rate: f64,
    pub min_tip_lamports: u64,
    pub max_tip_lamports: u64,
    pub max_tip_per_trade: u64,
    pub max_tip_spend_per_hour: u64,
    pub spent_this_hour: u64,
    pub window_submitted: u32,
    pub window_landed: u32,
}

impl Default for TipOptimizer {
    fn default() -> Self {
        Self {
            regime: MarketRegime::Normal,
            target_landed_rate: 0.85,
            min_tip_lamports: 500_000,         // 0.0005 SOL
            max_tip_lamports: 10_000_000,      // 0.010 SOL
            max_tip_per_trade: 5_000_000,      // 0.005 SOL
            max_tip_spend_per_hour: 50_000_000,// 0.050 SOL
            spent_this_hour: 0,
            window_submitted: 0,
            window_landed: 0,
        }
    }
}

impl TipOptimizer {
    pub fn new(
        target_landed_rate: f64,
        min_tip: u64,
        max_tip: u64,
        max_tip_per_trade: u64,
        max_tip_spend_per_hour: u64,
    ) -> Self {
        Self {
            regime: MarketRegime::Normal,
            target_landed_rate,
            min_tip_lamports: min_tip,
            max_tip_lamports: max_tip,
            max_tip_per_trade,
            max_tip_spend_per_hour,
            spent_this_hour: 0,
            window_submitted: 0,
            window_landed: 0,
        }
    }

    pub fn set_regime(&mut self, regime: MarketRegime) {
        self.regime = regime;
    }

    pub fn current_landed_rate(&self) -> f64 {
        if self.window_submitted == 0 {
            1.0
        } else {
            self.window_landed as f64 / self.window_submitted as f64
        }
    }

    /// Calculate dynamic tip based on market regime and rolling landed rate
    pub fn calculate_optimal_tip(&self) -> Result<u64, ExecutionError> {
        if self.spent_this_hour >= self.max_tip_spend_per_hour {
            return Err(ExecutionError::BudgetExhausted {
                requested_lamports: self.min_tip_lamports,
                remaining_lamports: 0,
            });
        }

        // Base tip by regime
        let base_tip = match self.regime {
            MarketRegime::Quiet => self.min_tip_lamports,
            MarketRegime::Normal => self.min_tip_lamports.saturating_mul(2), // 1.0M
            MarketRegime::Hot => self.min_tip_lamports.saturating_mul(4),    // 2.0M
            MarketRegime::MevWar => self.max_tip_per_trade,                 // 5.0M
            MarketRegime::LiquidityDry => self.min_tip_lamports,
        };

        // If landed rate is falling behind target, dynamically scale up tip
        let rate = self.current_landed_rate();
        let multiplier = if self.window_submitted >= 3 && rate < self.target_landed_rate {
            let deficit = self.target_landed_rate - rate;
            1.0 + (deficit * 2.0).min(1.5) // up to +150% boost
        } else {
            1.0
        };

        let calculated = (base_tip as f64 * multiplier) as u64;
        let clamped = calculated
            .max(self.min_tip_lamports)
            .min(self.max_tip_per_trade)
            .min(self.max_tip_lamports);

        // Check hour budget remaining
        let remaining_budget = self.max_tip_spend_per_hour.saturating_sub(self.spent_this_hour);
        if clamped > remaining_budget {
            Ok(remaining_budget.max(self.min_tip_lamports))
        } else {
            Ok(clamped)
        }
    }

    pub fn record_submission(&mut self, tip: u64) {
        self.spent_this_hour = self.spent_this_hour.saturating_add(tip);
        self.window_submitted = self.window_submitted.saturating_add(1);
    }

    pub fn record_outcome(&mut self, landed: bool) {
        if landed {
            self.window_landed = self.window_landed.saturating_add(1);
        }

        // Rolling window decay after 20 events
        if self.window_submitted >= 20 {
            self.window_submitted /= 2;
            self.window_landed /= 2;
        }
    }

    pub fn reset_hourly_budget(&mut self) {
        self.spent_this_hour = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tip_optimizer_regimes_and_landed_rate_boost() {
        let mut opt = TipOptimizer::default();
        let normal_tip = opt.calculate_optimal_tip().unwrap();
        assert_eq!(normal_tip, 1_000_000); // 2x min_tip

        opt.set_regime(MarketRegime::MevWar);
        let war_tip = opt.calculate_optimal_tip().unwrap();
        assert_eq!(war_tip, opt.max_tip_per_trade);

        // Simulate 4 misses
        opt.set_regime(MarketRegime::Normal);
        for _ in 0..4 {
            opt.record_submission(1_000_000);
            opt.record_outcome(false);
        }

        // Landed rate is 0.0 -> tip should be boosted up to max_tip_per_trade
        let boosted = opt.calculate_optimal_tip().unwrap();
        assert!(boosted > normal_tip);
    }
}
