use crate::errors::ExecutionError;

#[derive(Debug, Clone)]
pub struct BudgetGovernor {
    pub hourly_limit_lamports: u64,
    pub daily_limit_lamports: u64,
    pub emergency_exit_reserve_lamports: u64,
    pub spent_hour: u64,
    pub spent_day: u64,
}

impl Default for BudgetGovernor {
    fn default() -> Self {
        Self {
            hourly_limit_lamports: 100_000_000,        // 0.10 SOL / hour
            daily_limit_lamports: 1_000_000_000,       // 1.0 SOL / day
            emergency_exit_reserve_lamports: 50_000_000,// 0.05 SOL dedicated emergency exit reserve
            spent_hour: 0,
            spent_day: 0,
        }
    }
}

impl BudgetGovernor {
    pub fn new(hourly_limit: u64, daily_limit: u64, emergency_reserve: u64) -> Self {
        Self {
            hourly_limit_lamports: hourly_limit,
            daily_limit_lamports: daily_limit,
            emergency_exit_reserve_lamports: emergency_reserve,
            spent_hour: 0,
            spent_day: 0,
        }
    }

    /// Check if new trade entry is permitted within normal operational budget
    pub fn check_entry_budget(&self, amount: u64) -> Result<(), ExecutionError> {
        let remaining_hour = self.hourly_limit_lamports.saturating_sub(self.spent_hour);
        let remaining_day = self.daily_limit_lamports.saturating_sub(self.spent_day);

        let min_remaining = remaining_hour.min(remaining_day);

        if amount > min_remaining {
            Err(ExecutionError::BudgetExhausted {
                requested_lamports: amount,
                remaining_lamports: min_remaining,
            })
        } else {
            Ok(())
        }
    }

    /// Check if exit transaction is permitted (can tap emergency reserve if needed)
    pub fn check_exit_budget(&self, amount: u64) -> Result<(), ExecutionError> {
        let total_avail = self
            .hourly_limit_lamports
            .saturating_sub(self.spent_hour)
            .saturating_add(self.emergency_exit_reserve_lamports);

        if amount > total_avail {
            Err(ExecutionError::BudgetExhausted {
                requested_lamports: amount,
                remaining_lamports: total_avail,
            })
        } else {
            Ok(())
        }
    }

    /// Record execution expenditure (Jito tip + priority fees)
    pub fn record_spend(&mut self, amount: u64, is_emergency_exit: bool) {
        if is_emergency_exit {
            // Deplete emergency reserve first
            let from_reserve = amount.min(self.emergency_exit_reserve_lamports);
            self.emergency_exit_reserve_lamports -= from_reserve;
            let remainder = amount - from_reserve;
            self.spent_hour = self.spent_hour.saturating_add(remainder);
            self.spent_day = self.spent_day.saturating_add(remainder);
        } else {
            self.spent_hour = self.spent_hour.saturating_add(amount);
            self.spent_day = self.spent_day.saturating_add(amount);
        }
    }

    pub fn reset_hourly(&mut self) {
        self.spent_hour = 0;
    }

    pub fn reset_daily(&mut self) {
        self.spent_day = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_budget_governor_pauses_entries() {
        let mut gov = BudgetGovernor::new(10_000_000, 50_000_000, 5_000_000);

        // Entry 1: 8M allowed
        assert!(gov.check_entry_budget(8_000_000).is_ok());
        gov.record_spend(8_000_000, false);

        // Entry 2: 3M fails because 8M + 3M > 10M hourly limit
        assert!(matches!(
            gov.check_entry_budget(3_000_000),
            Err(ExecutionError::BudgetExhausted { .. })
        ));

        // But emergency exit of 3M is still permitted due to 5M emergency reserve!
        assert!(gov.check_exit_budget(3_000_000).is_ok());
    }
}
