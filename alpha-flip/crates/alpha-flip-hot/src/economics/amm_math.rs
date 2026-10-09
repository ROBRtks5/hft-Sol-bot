/// Precision arithmetic for Constant Product AMM formulas (x * y = k)
/// Uses u128 to prevent overflow during intermediate multiplications.

pub const BPS_DENOMINATOR: u128 = 10_000;

/// Calculate output tokens for exact input SOL:
/// dy = (y * dx_net) / (x + dx_net)
#[inline]
pub fn constant_product_swap_exact_in(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    fee_bps: u16,
) -> Option<u64> {
    if reserve_in == 0 || reserve_out == 0 || amount_in == 0 {
        return Some(0);
    }

    let r_in = reserve_in as u128;
    let r_out = reserve_out as u128;
    let a_in = amount_in as u128;
    let fee_factor = (BPS_DENOMINATOR - fee_bps as u128) as u128;

    // a_in_net = a_in * (10000 - fee_bps) / 10000
    let a_in_net = (a_in * fee_factor) / BPS_DENOMINATOR;
    if a_in_net == 0 {
        return Some(0);
    }

    let numerator = r_out.checked_mul(a_in_net)?;
    let denominator = r_in.checked_add(a_in_net)?;

    let dy = numerator / denominator;
    Some(dy as u64)
}

/// Calculate required input to receive exact output tokens:
/// dx = (x * dy) / ((y - dy) * (1 - fee))
#[inline]
pub fn constant_product_swap_exact_out(
    reserve_in: u64,
    reserve_out: u64,
    amount_out: u64,
    fee_bps: u16,
) -> Option<u64> {
    if reserve_in == 0 || reserve_out == 0 || amount_out == 0 || amount_out >= reserve_out {
        return None;
    }

    let r_in = reserve_in as u128;
    let r_out = reserve_out as u128;
    let a_out = amount_out as u128;
    let fee_factor = (BPS_DENOMINATOR - fee_bps as u128) as u128;

    let numerator = (r_in * a_out).checked_mul(BPS_DENOMINATOR)?;
    let denominator = (r_out - a_out).checked_mul(fee_factor)?;

    // Ceiling division
    let dx = (numerator + denominator - 1) / denominator;
    Some(dx as u64)
}

/// Calculate instantaneous spot price (reserve_in / reserve_out)
#[inline]
pub fn calculate_spot_price(reserve_in: u64, reserve_out: u64) -> f64 {
    if reserve_out == 0 {
        0.0
    } else {
        reserve_in as f64 / reserve_out as f64
    }
}
