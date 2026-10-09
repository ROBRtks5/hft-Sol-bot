use crate::economics::fee_model::RoundtripFeeEstimate;
use crate::errors::EconomicError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EdgeEvaluation {
    pub gross_edge_bps: u16,
    pub roundtrip_cost_bps: u16,
    pub slippage_budget_bps: u16,
    pub hurdle_bps: u16,
    pub margin_of_safety_bps: u16,
    pub required_edge_bps: u16,
    pub net_expected_edge_bps: i32,
    pub approved: bool,
}

#[derive(Debug, Clone)]
pub struct EconomicEdgeGate {
    pub margin_of_safety_bps: u16,
    pub slippage_budget_bps: u16,
}

impl Default for EconomicEdgeGate {
    fn default() -> Self {
        Self {
            margin_of_safety_bps: 150, // 1.5% margin of safety
            slippage_budget_bps: 100,  // 1.0% dynamic slippage budget
        }
    }
}

impl EconomicEdgeGate {
    pub fn new(margin_of_safety_bps: u16, slippage_budget_bps: u16) -> Self {
        Self {
            margin_of_safety_bps,
            slippage_budget_bps,
        }
    }

    /// Evaluates if the expected gross edge clears friction hurdle + safety margin
    pub fn evaluate_edge(
        &self,
        gross_edge_bps: u16,
        fees: &RoundtripFeeEstimate,
    ) -> Result<EdgeEvaluation, EconomicError> {
        let hurdle_bps = fees.total_cost_bps.saturating_add(self.slippage_budget_bps);
        let required_edge_bps = hurdle_bps.saturating_add(self.margin_of_safety_bps);

        let net_expected_edge_bps = (gross_edge_bps as i32) - (hurdle_bps as i32);

        if gross_edge_bps < required_edge_bps {
            return Err(EconomicError::InsufficientEdge {
                gross_edge_bps,
                hurdle_bps,
                margin_bps: self.margin_of_safety_bps,
            });
        }

        Ok(EdgeEvaluation {
            gross_edge_bps,
            roundtrip_cost_bps: fees.total_cost_bps,
            slippage_budget_bps: self.slippage_budget_bps,
            hurdle_bps,
            margin_of_safety_bps: self.margin_of_safety_bps,
            required_edge_bps,
            net_expected_edge_bps,
            approved: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economics::fee_model::{DexProtocol, FeeModel};

    #[test]
    fn test_edge_gate_approves_strong_edge() {
        let gate = EconomicEdgeGate::new(150, 100);
        let fee_model = FeeModel::default();
        let fees = fee_model.estimate_roundtrip(DexProtocol::PumpFun, 1_000_000_000, false);

        // fees are ~221 bps, hurdle = 221 + 100 = 321 bps, required = 321 + 150 = 471 bps
        let gross_edge = 600; // 6.0% gross momentum edge
        let eval = gate.evaluate_edge(gross_edge, &fees).unwrap();
        assert!(eval.approved);
        assert!(eval.net_expected_edge_bps > 0);
    }

    #[test]
    fn test_edge_gate_rejects_sub_hurdle_trade() {
        let gate = EconomicEdgeGate::new(150, 100);
        let fee_model = FeeModel::default();
        let fees = fee_model.estimate_roundtrip(DexProtocol::PumpFun, 1_000_000_000, false);

        let small_gross_edge = 300; // 3.0% edge (insufficient for 2.21% fees + 1% slippage + 1.5% margin)
        let eval = gate.evaluate_edge(small_gross_edge, &fees);
        assert!(eval.is_err());
        match eval.unwrap_err() {
            EconomicError::InsufficientEdge { gross_edge_bps, .. } => {
                assert_eq!(gross_edge_bps, 300);
            }
            _ => panic!("Expected InsufficientEdge"),
        }
    }
}
