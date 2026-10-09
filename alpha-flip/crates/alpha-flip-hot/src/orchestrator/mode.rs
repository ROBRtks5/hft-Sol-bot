use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Operating modes for Alpha-Flip v3.2 execution orchestrator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperatingMode {
    /// Ingest Yellowstone gRPC, decode instructions, score signals, but NEVER send orders.
    Observe,
    /// Ingest signals, calculate sizing, simulate orders and fills in memory, track virtual PnL.
    Shadow,
    /// Real on-chain trading via Jito bundles when all risk & economic gates pass.
    Live,
    /// Active on startup or when state discrepancy is detected; only allows recovery actions.
    Recovering,
    /// Temporarily paused due to drawdown or external trigger; no new entries, defensively manage open position.
    Paused,
    /// Immediate emergency halt: stop all entries, fire aggressive market exits for open position, alert operators.
    KillSwitch,
}

impl OperatingMode {
    /// Can new trade entries be submitted?
    pub fn allows_new_orders(&self) -> bool {
        matches!(self, OperatingMode::Live)
    }

    /// Can simulated paper orders be processed?
    pub fn allows_simulation(&self) -> bool {
        matches!(self, OperatingMode::Shadow)
    }

    /// Should existing positions still be managed and exited defensively?
    pub fn manages_open_position(&self) -> bool {
        matches!(
            self,
            OperatingMode::Live
                | OperatingMode::Shadow
                | OperatingMode::Paused
                | OperatingMode::KillSwitch
                | OperatingMode::Recovering
        )
    }

    /// Is this a safety halt condition?
    pub fn is_halt(&self) -> bool {
        matches!(self, OperatingMode::Paused | OperatingMode::KillSwitch)
    }

    /// Does this mode require emergency liquidation?
    pub fn requires_emergency_dump(&self) -> bool {
        matches!(self, OperatingMode::KillSwitch)
    }
}

impl Default for OperatingMode {
    fn default() -> Self {
        OperatingMode::Observe
    }
}

impl fmt::Display for OperatingMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OperatingMode::Observe => write!(f, "OBSERVE"),
            OperatingMode::Shadow => write!(f, "SHADOW"),
            OperatingMode::Live => write!(f, "LIVE"),
            OperatingMode::Recovering => write!(f, "RECOVERING"),
            OperatingMode::Paused => write!(f, "PAUSED"),
            OperatingMode::KillSwitch => write!(f, "KILL_SWITCH"),
        }
    }
}

impl FromStr for OperatingMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_uppercase().as_str() {
            "OBSERVE" => Ok(OperatingMode::Observe),
            "SHADOW" => Ok(OperatingMode::Shadow),
            "LIVE" => Ok(OperatingMode::Live),
            "RECOVERING" => Ok(OperatingMode::Recovering),
            "PAUSED" => Ok(OperatingMode::Paused),
            "KILL" | "KILL_SWITCH" | "KILLSWITCH" => Ok(OperatingMode::KillSwitch),
            other => Err(format!(
                "Unknown operating mode '{}'. Expected: OBSERVE, SHADOW, LIVE, RECOVERING, PAUSED, KILL_SWITCH",
                other
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mode_properties() {
        assert!(OperatingMode::Live.allows_new_orders());
        assert!(!OperatingMode::Shadow.allows_new_orders());
        assert!(OperatingMode::Shadow.allows_simulation());
        assert!(!OperatingMode::Observe.allows_new_orders());
        assert!(!OperatingMode::Observe.allows_simulation());

        assert!(OperatingMode::Paused.manages_open_position());
        assert!(!OperatingMode::Paused.allows_new_orders());

        assert!(OperatingMode::KillSwitch.requires_emergency_dump());
    }

    #[test]
    fn test_mode_parsing() {
        assert_eq!("live".parse::<OperatingMode>().unwrap(), OperatingMode::Live);
        assert_eq!("KILL_SWITCH".parse::<OperatingMode>().unwrap(), OperatingMode::KillSwitch);
        assert_eq!("kill".parse::<OperatingMode>().unwrap(), OperatingMode::KillSwitch);
        assert_eq!("recovering".parse::<OperatingMode>().unwrap(), OperatingMode::Recovering);
    }
}
