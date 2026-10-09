use serde::{Deserialize, Serialize};

/// Fast zero-copy classification result from transaction log prefiltering
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct LogPrefilterResult {
    pub has_pump_create: bool,
    pub has_pump_buy: bool,
    pub has_pump_sell: bool,
    pub has_raydium_swap: bool,
    pub has_raydium_init: bool,
    pub has_token_2022_hook: bool,
    pub should_decode: bool,
}

pub struct LogPrefilter;

impl LogPrefilter {
    /// Zero-allocation substring inspection of execution logs to quickly weed out irrelevant transactions
    pub fn scan(logs: &[String]) -> LogPrefilterResult {
        let mut res = LogPrefilterResult::default();

        if logs.is_empty() {
            // If logs are empty, do not skip decoding if instructions exist
            res.should_decode = true;
            return res;
        }

        for log in logs {
            let line = log.as_str();

            // Pump.fun patterns
            if line.contains("Instruction: Buy") {
                res.has_pump_buy = true;
                res.should_decode = true;
            } else if line.contains("Instruction: Sell") {
                res.has_pump_sell = true;
                res.should_decode = true;
            } else if line.contains("Instruction: Create") {
                res.has_pump_create = true;
                res.should_decode = true;
            }
            // Raydium patterns
            else if line.contains("Instruction: Swap")
                || line.contains("ray_log")
                || line.contains("SwapBaseIn")
                || line.contains("SwapBaseOut")
            {
                res.has_raydium_swap = true;
                res.should_decode = true;
            } else if line.contains("initialize2") || line.contains("Initialize2") {
                res.has_raydium_init = true;
                res.should_decode = true;
            }
            // Token-2022 transfer hook or extension invocations
            else if line.contains("TransferHook") || line.contains("transfer_hook") {
                res.has_token_2022_hook = true;
                res.should_decode = true;
            }
        }

        res
    }
}
