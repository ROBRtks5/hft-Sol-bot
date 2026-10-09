use crate::economics::fee_model::{
    BASE_SOLANA_SIGNATURE_FEE, RENT_EXEMPT_ATA_LAMPORTS,
};
use serde::{Deserialize, Serialize};

/// Detailed realistic cost breakdown of a simulated trade
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct SimulatedFrictionCost {
    /// Jito tip paid on entry bundle
    pub entry_tip_lamports: u64,
    /// Jito tip paid on exit bundle(s)
    pub exit_tip_lamports: u64,
    /// Base Solana signature fees (2 on entry, 2 on exit)
    pub base_network_fees_lamports: u64,
    /// Compute budget priority fees
    pub priority_fees_lamports: u64,
    /// Associated Token Account creation rent (reclaimed if closed)
    pub ata_rent_lamports: u64,
    /// DEX liquidity provider fee (1% Pump.fun / 0.25% Raydium)
    pub dex_fees_lamports: u64,
    /// Estimated adverse slippage & price impact cost
    pub price_impact_cost_lamports: u64,
}

impl SimulatedFrictionCost {
    pub fn total_friction_lamports(&self) -> u64 {
        self.entry_tip_lamports
            .saturating_add(self.exit_tip_lamports)
            .saturating_add(self.base_network_fees_lamports)
            .saturating_add(self.priority_fees_lamports)
            .saturating_add(self.ata_rent_lamports)
            .saturating_add(self.dex_fees_lamports)
            .saturating_add(self.price_impact_cost_lamports)
    }
}

/// Simulated trade outcome record
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShadowTradeRecord {
    pub trade_id: String,
    pub mint: String,
    pub entry_slot: u64,
    pub exit_slot: u64,
    pub hold_duration_slots: u64,
    pub gross_entry_sol_lamports: u64,
    pub gross_exit_proceeds_lamports: u64,
    pub friction: SimulatedFrictionCost,
    pub gross_pnl_lamports: i64,
    pub net_pnl_lamports: i64,
    pub net_roi_bps: i32,
    pub landed_successfully: bool,
    pub exit_reason: String,
}

/// Cumulative aggregate Shadow PnL and trading metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShadowPnlReport {
    pub total_simulated_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub win_rate_pct: f64,
    pub gross_pnl_lamports: i64,
    pub total_friction_paid_lamports: u64,
    pub net_pnl_lamports: i64,
    pub profit_factor: f64,
    pub sharpe_ratio_approx: f64,
    pub mathematical_expectancy_lamports: i64,
    pub max_drawdown_lamports: u64,
    pub max_drawdown_pct: f64,
    pub average_hold_duration_slots: f64,
    pub trades: Vec<ShadowTradeRecord>,
}

/// Strict mathematical model for evaluating shadow trading PnL
pub struct ShadowPnlModel {
    pub trades: Vec<ShadowTradeRecord>,
    pub running_equity_lamports: i64,
    pub peak_equity_lamports: i64,
    pub max_drawdown_lamports: u64,
}

impl Default for ShadowPnlModel {
    fn default() -> Self {
        Self::new()
    }
}

impl ShadowPnlModel {
    pub fn new() -> Self {
        Self {
            trades: Vec::new(),
            running_equity_lamports: 0,
            peak_equity_lamports: 0,
            max_drawdown_lamports: 0,
        }
    }

    /// Record a completed shadow trade with strict cost deduction
    pub fn record_trade(&mut self, trade: ShadowTradeRecord) {
        self.running_equity_lamports += trade.net_pnl_lamports;

        if self.running_equity_lamports > self.peak_equity_lamports {
            self.peak_equity_lamports = self.running_equity_lamports;
        } else {
            let current_dd = (self.peak_equity_lamports - self.running_equity_lamports).max(0) as u64;
            if current_dd > self.max_drawdown_lamports {
                self.max_drawdown_lamports = current_dd;
            }
        }

        self.trades.push(trade);
    }

    /// Generate comprehensive performance and statistical expectancy report
    pub fn generate_report(&self) -> ShadowPnlReport {
        if self.trades.is_empty() {
            return ShadowPnlReport::default();
        }

        let mut winning = 0;
        let mut losing = 0;
        let mut gross_pnl: i64 = 0;
        let mut net_pnl: i64 = 0;
        let mut total_friction: u64 = 0;
        let mut sum_win_lamports: u64 = 0;
        let mut sum_loss_lamports: u64 = 0;
        let mut total_hold_slots: u64 = 0;

        let mut net_pnls_f64 = Vec::with_capacity(self.trades.len());

        for t in &self.trades {
            gross_pnl += t.gross_pnl_lamports;
            net_pnl += t.net_pnl_lamports;
            total_friction += t.friction.total_friction_lamports();
            total_hold_slots += t.hold_duration_slots;
            net_pnls_f64.push(t.net_pnl_lamports as f64);

            if t.net_pnl_lamports > 0 {
                winning += 1;
                sum_win_lamports += t.net_pnl_lamports as u64;
            } else {
                losing += 1;
                sum_loss_lamports += (-t.net_pnl_lamports) as u64;
            }
        }

        let total_trades = self.trades.len();
        let win_rate_pct = (winning as f64 / total_trades as f64) * 100.0;
        let profit_factor = if sum_loss_lamports == 0 {
            if sum_win_lamports > 0 { 999.0 } else { 0.0 }
        } else {
            sum_win_lamports as f64 / sum_loss_lamports as f64
        };

        // Mathematical Expectancy = (Win% * Avg Win) - (Loss% * Avg Loss)
        let avg_win = if winning > 0 {
            sum_win_lamports as f64 / winning as f64
        } else {
            0.0
        };
        let avg_loss = if losing > 0 {
            sum_loss_lamports as f64 / losing as f64
        } else {
            0.0
        };
        let p_win = winning as f64 / total_trades as f64;
        let p_loss = losing as f64 / total_trades as f64;
        let expectancy = (p_win * avg_win) - (p_loss * avg_loss);

        // Approximate Sharpe Ratio: mean / std_dev
        let mean_pnl = net_pnls_f64.iter().sum::<f64>() / total_trades as f64;
        let variance = net_pnls_f64
            .iter()
            .map(|&p| (p - mean_pnl).powi(2))
            .sum::<f64>()
            / total_trades.max(2) as f64;
        let std_dev = variance.sqrt();
        let sharpe_ratio_approx = if std_dev > 0.0 {
            mean_pnl / std_dev
        } else {
            0.0
        };

        let avg_hold = total_hold_slots as f64 / total_trades as f64;

        ShadowPnlReport {
            total_simulated_trades: total_trades,
            winning_trades: winning,
            losing_trades: losing,
            win_rate_pct,
            gross_pnl_lamports: gross_pnl,
            total_friction_paid_lamports: total_friction,
            net_pnl_lamports: net_pnl,
            profit_factor,
            sharpe_ratio_approx,
            mathematical_expectancy_lamports: expectancy as i64,
            max_drawdown_lamports: self.max_drawdown_lamports,
            max_drawdown_pct: 0.0, // Calculated against initial virtual balance if configured
            average_hold_duration_slots: avg_hold,
            trades: self.trades.clone(),
        }
    }
}
