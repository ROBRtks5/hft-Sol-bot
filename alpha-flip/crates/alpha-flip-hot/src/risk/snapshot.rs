use serde::{Deserialize, Serialize};

#[inline]
pub fn saturate_score_u8(val: u32) -> u8 {
    if val > 100 {
        100
    } else {
        val as u8
    }
}

#[inline]
pub fn saturate_bps_u16(val: u32) -> u16 {
    if val > 10_000 {
        10_000
    } else {
        val as u16
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskTier {
    Low,
    Moderate,
    High,
    Critical,
}

impl From<u8> for RiskTier {
    fn from(score: u8) -> Self {
        match score {
            0..=25 => RiskTier::Low,
            26..=50 => RiskTier::Moderate,
            51..=75 => RiskTier::High,
            _ => RiskTier::Critical,
        }
    }
}

/// Comprehensive multi-factor risk evaluation snapshot for an active token mint
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiskSnapshot {
    pub overall_risk_score: u8,
    pub hot_cabal_score: u8,
    pub cold_cabal_score: u8,
    pub final_cabal_score: u8,
    pub organic_score: u8,
    pub dev_proxy_risk: u8,
    pub smart_money_score: u8,
    pub smart_money_dump_warning: bool,
    pub transfer_hook_risk: bool,
    pub authority_risk: bool,
    pub liquidity_risk: u8,
    pub is_trade_allowed: bool,
    pub size_reduction_bps: u16,
    pub tier: RiskTier,
    pub reasons: Vec<String>,

    // Backward compatibility fields
    pub cabal_risk: u8,
    pub dev_dump_risk: u8,
    pub smart_money_discount: u8,
    pub has_transfer_hook_veto: bool,
    pub mint_authority_veto: bool,
    pub freeze_authority_veto: bool,
}

impl RiskSnapshot {
    pub fn new_composite(
        hot_cabal: u8,
        cold_cabal: u8,
        organic: u8,
        dev_proxy: u8,
        smart_money: u8,
        smart_money_dump_warning: bool,
        transfer_hook: bool,
        mint_auth_revoked: bool,
        freeze_auth_revoked: bool,
        liquidity_sol: f64,
        min_liquidity_sol: f64,
    ) -> Self {
        let mut reasons = Vec::new();

        // 1. Final cabal score takes maximum of hot streaming and cold advisory
        let final_cabal = hot_cabal.max(cold_cabal);

        // 2. Authority risks
        let authority_risk = !mint_auth_revoked || !freeze_auth_revoked;
        if !mint_auth_revoked {
            reasons.push("Mint authority not revoked".to_string());
        }
        if !freeze_auth_revoked {
            reasons.push("Freeze authority not revoked".to_string());
        }

        // 3. Transfer hook risk
        if transfer_hook {
            reasons.push("Token-2022 TransferHook honeypot detected".to_string());
        }

        // 4. Dev proxy risk
        if dev_proxy >= 50 {
            reasons.push(format!("High dev proxy distribution risk: {}/100", dev_proxy));
        }

        // 5. Liquidity risk
        let liquidity_penalty = if liquidity_sol < min_liquidity_sol {
            let deficit = (min_liquidity_sol - liquidity_sol).max(0.0) / min_liquidity_sol;
            let pen = (deficit * 40.0).round() as u8;
            reasons.push(format!("Liquidity ({:.1} SOL) below target ({:.1} SOL)", liquidity_sol, min_liquidity_sol));
            pen
        } else {
            0
        };

        // 6. Overall risk formula
        let raw_risk: u32 = (final_cabal as u32 * 35 / 100)
            + (dev_proxy as u32 * 30 / 100)
            + (liquidity_penalty as u32)
            + if authority_risk { 25 } else { 0 }
            + if smart_money_dump_warning { 15 } else { 0 };

        let organic_mitigation = (organic as u32 * 20 / 100);
        let sm_mitigation = if !smart_money_dump_warning { (smart_money as u32 * 15 / 100) } else { 0 };

        let composite = raw_risk.saturating_sub(organic_mitigation).saturating_sub(sm_mitigation);
        let overall_risk_score = saturate_score_u8(composite);
        let tier = RiskTier::from(overall_risk_score);

        // Hard veto conditions
        let hard_veto = transfer_hook || authority_risk || final_cabal > 80 || dev_proxy > 80 || overall_risk_score > 75;
        let is_trade_allowed = !hard_veto;

        let size_reduction_bps = match tier {
            RiskTier::Low => 0,
            RiskTier::Moderate => 2_500,
            RiskTier::High => 5_000,
            RiskTier::Critical => 10_000,
        };

        Self {
            overall_risk_score,
            hot_cabal_score: hot_cabal,
            cold_cabal_score: cold_cabal,
            final_cabal_score: final_cabal,
            organic_score: organic,
            dev_proxy_risk: dev_proxy,
            smart_money_score: smart_money,
            smart_money_dump_warning,
            transfer_hook_risk: transfer_hook,
            authority_risk,
            liquidity_risk: liquidity_penalty,
            is_trade_allowed,
            size_reduction_bps,
            tier,
            reasons,

            // Backward compatibility
            cabal_risk: final_cabal,
            dev_dump_risk: dev_proxy,
            smart_money_discount: sm_mitigation as u8,
            has_transfer_hook_veto: transfer_hook,
            mint_authority_veto: !mint_auth_revoked,
            freeze_authority_veto: !freeze_auth_revoked,
        }
    }

    /// Backward compatibility constructor for tests
    pub fn evaluate(
        cabal_score: u8,
        dev_risk: u8,
        organic_score: u8,
        smart_money_score: u8,
        has_transfer_hook: bool,
        mint_auth_revoked: bool,
        freeze_auth_revoked: bool,
        liquidity_sol: f64,
        min_liquidity_sol: f64,
    ) -> Self {
        Self::new_composite(
            cabal_score,
            0,
            organic_score,
            dev_risk,
            smart_money_score,
            false,
            has_transfer_hook,
            mint_auth_revoked,
            freeze_auth_revoked,
            liquidity_sol,
            min_liquidity_sol,
        )
    }
}
