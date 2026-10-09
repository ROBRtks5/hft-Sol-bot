use crate::risk::cabal_hot_scoring::RollingFundingGraph;
use crate::types::{Lamports, Pubkey, Slot};

pub struct OrganicScorer;

impl OrganicScorer {
    /// Multi-factor organic distribution score (0..=100, higher = more organic retail demand)
    pub fn score(
        buyers: &[Pubkey],
        buy_amounts: &[Lamports],
        buy_slots: &[Slot],
        cabal_score: u8,
        smart_money_quality_bonus: u8,
        funding_graph: &RollingFundingGraph,
    ) -> u8 {
        if buyers.is_empty() {
            return 0;
        }

        let mut organic_points: f64 = 0.0;

        // Factor 1: Non-cabal purity factor (max 35 pts)
        let non_cabal_ratio = (100u8.saturating_sub(cabal_score)) as f64 / 100.0;
        organic_points += non_cabal_ratio * 35.0;

        // Factor 2: Funding diversity factor (max 20 pts)
        let shared_ratio = funding_graph.shared_funding_ratio(buyers);
        let funding_diversity = (1.0 - shared_ratio).max(0.0);
        organic_points += funding_diversity * 20.0;

        // Factor 3: Buy size entropy / diversity (max 20 pts)
        if buy_amounts.len() >= 3 {
            let amounts_f64: Vec<f64> = buy_amounts.iter().map(|a| a.as_u64() as f64).collect();
            let mean = amounts_f64.iter().sum::<f64>() / amounts_f64.len() as f64;
            let variance = amounts_f64
                .iter()
                .map(|v| (v - mean).powi(2))
                .sum::<f64>()
                / amounts_f64.len() as f64;
            let cv = if mean > 0.0 { variance.sqrt() / mean } else { 0.0 };

            // Organic retail has high CV (> 0.40 variance in purchase amounts)
            let entropy_score = (cv / 0.80).min(1.0);
            organic_points += entropy_score * 20.0;
        }

        // Factor 4: Time dispersion (slots span over accumulation, max 15 pts)
        if buy_slots.len() >= 2 {
            let min_slot = buy_slots.iter().min().copied().unwrap_or(Slot(0));
            let max_slot = buy_slots.iter().max().copied().unwrap_or(Slot(0));
            let span = max_slot.saturating_sub(min_slot);

            // Natural retail accumulation spans > 50 slots (~20s)
            let span_score = (span as f64 / 75.0).min(1.0);
            organic_points += span_score * 15.0;
        }

        // Factor 5: Smart money bonus (max 10 pts)
        organic_points += (smart_money_quality_bonus as f64 * 0.10).min(10.0);

        organic_points.round().min(100.0) as u8
    }
}
