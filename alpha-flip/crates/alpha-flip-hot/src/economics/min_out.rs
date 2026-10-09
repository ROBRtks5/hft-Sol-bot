use crate::errors::EconomicError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlippageTier {
    Tight,      // 50 bps (0.5%)
    Standard,   // 100 bps (1.0%)
    Aggressive, // 250 bps (2.5%)
}

impl SlippageTier {
    pub fn to_bps(&self) -> u16 {
        match self {
            SlippageTier::Tight => 50,
            SlippageTier::Standard => 100,
            SlippageTier::Aggressive => 250,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MinOutCalculator {
    pub default_slippage_bps: u16,
    pub max_slippage_bps: u16,
}

impl Default for MinOutCalculator {
    fn default() -> Self {
        Self {
            default_slippage_bps: 100,
            max_slippage_bps: 350,
        }
    }
}

impl MinOutCalculator {
    pub fn new(default_slippage_bps: u16, max_slippage_bps: u16) -> Self {
        Self {
            default_slippage_bps,
            max_slippage_bps,
        }
    }

    /// Calculate dynamic slippage in basis points based on velocity and volatility
    pub fn calculate_dynamic_slippage(
        &self,
        velocity_score: f32, // 0.0 to 1.0+
        volatility_bps: u16,
    ) -> u16 {
        let base_bps = if velocity_score > 0.8 || volatility_bps > 200 {
            SlippageTier::Aggressive.to_bps()
        } else if velocity_score > 0.4 || volatility_bps > 100 {
            SlippageTier::Standard.to_bps()
        } else {
            SlippageTier::Tight.to_bps()
        };

        base_bps.min(self.max_slippage_bps)
    }

    /// Compute minimum expected output tokens/lamports after subtracting slippage tolerance
    pub fn calculate_min_out(&self, expected_amount_out: u64, slippage_bps: u16) -> u64 {
        if expected_amount_out == 0 {
            return 0;
        }

        let clamped_slippage = slippage_bps.min(self.max_slippage_bps).min(10_000);
        let factor = 10_000u128.saturating_sub(clamped_slippage as u128);

        let min_out = (expected_amount_out as u128 * factor) / 10_000;
        min_out as u64
    }

    /// Verify an executed fill against the calculated min_out requirement
    pub fn verify_fill(&self, actual_out: u64, min_out: u64) -> Result<(), EconomicError> {
        if actual_out < min_out {
            Err(EconomicError::SlippageToleranceBreached {
                actual: actual_out,
                min_out,
            })
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_min_out_calculation() {
        let calc = MinOutCalculator::new(100, 350);
        let expected = 1_000_000_000; // 1B units
        let min_out = calc.calculate_min_out(expected, 100); // 1.0% slippage

        // 1B * 0.99 = 990M
        assert_eq!(min_out, 990_000_000);
    }

    #[test]
    fn test_dynamic_slippage_selection() {
        let calc = MinOutCalculator::default();

        let low = calc.calculate_dynamic_slippage(0.1, 30);
        assert_eq!(low, 50);

        let med = calc.calculate_dynamic_slippage(0.5, 80);
        assert_eq!(med, 100);

        let high = calc.calculate_dynamic_slippage(0.9, 300);
        assert_eq!(high, 250);
    }

    #[test]
    fn test_verify_fill() {
        let calc = MinOutCalculator::default();
        assert!(calc.verify_fill(991_000_000, 990_000_000).is_ok());
        assert!(calc.verify_fill(990_000_000, 990_000_000).is_ok());
        assert!(matches!(
            calc.verify_fill(989_999_999, 990_000_000),
            Err(EconomicError::SlippageToleranceBreached { .. })
        ));
    }
}
