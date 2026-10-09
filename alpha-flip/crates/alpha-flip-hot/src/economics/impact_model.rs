use crate::errors::EconomicError;

#[derive(Debug, Clone)]
pub struct PriceImpactModel {
    pub max_impact_bps: u16,
}

impl Default for PriceImpactModel {
    fn default() -> Self {
        Self {
            max_impact_bps: 300, // 3.0% maximum allowable impact
        }
    }
}

impl PriceImpactModel {
    pub fn new(max_impact_bps: u16) -> Self {
        Self { max_impact_bps }
    }

    /// Calculate price impact in basis points between the pre-trade spot price
    /// and the effective realized average price:
    /// impact_bps = |effective_price - spot_before| / spot_before * 10,000
    pub fn calculate_impact_bps(&self, spot_before: f64, effective_price: f64) -> u16 {
        if spot_before <= 0.0 || effective_price <= 0.0 {
            return 0;
        }

        let diff = (effective_price - spot_before).abs();
        let fraction = diff / spot_before;
        let bps = (fraction * 10_000.0).round();

        if bps > u16::MAX as f64 {
            u16::MAX
        } else {
            bps as u16
        }
    }

    /// Evaluate price impact against safety limits.
    /// Returns Ok(impact_bps) or Err(EconomicError::ExcessivePriceImpact)
    pub fn evaluate_impact(
        &self,
        spot_before: f64,
        effective_price: f64,
    ) -> Result<u16, EconomicError> {
        let impact_bps = self.calculate_impact_bps(spot_before, effective_price);

        if impact_bps > self.max_impact_bps {
            Err(EconomicError::ExcessivePriceImpact {
                impact_bps,
                max_bps: self.max_impact_bps,
            })
        } else {
            Ok(impact_bps)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_impact_calculation_normal() {
        let model = PriceImpactModel::new(300);
        let spot = 0.000030;
        let effective = 0.0000306; // 2% higher -> 200 bps
        let bps = model.calculate_impact_bps(spot, effective);
        assert_eq!(bps, 200);

        let eval = model.evaluate_impact(spot, effective);
        assert_eq!(eval, Ok(200));
    }

    #[test]
    fn test_impact_rejection_excessive() {
        let model = PriceImpactModel::new(200);
        let spot = 0.000030;
        let effective = 0.0000315; // 5% higher -> 500 bps
        let eval = model.evaluate_impact(spot, effective);

        assert_eq!(
            eval,
            Err(EconomicError::ExcessivePriceImpact {
                impact_bps: 500,
                max_bps: 200
            })
        );
    }
}
