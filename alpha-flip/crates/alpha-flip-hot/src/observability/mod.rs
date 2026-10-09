pub mod blackbox;
pub mod chat_bridge;
pub mod health;
pub mod logging;
pub mod metrics;
pub mod selftest;

pub use blackbox::{DiagnosticBlackBox, DiagnosticEventRecord, DiagnosticLogQuery, DiagnosticSeverity};
pub use chat_bridge::{ChatDiagnosticsBridge, OperatorIntent};
pub use health::{HealthChecker, HealthState, HealthStatus};
pub use logging::{init_logging, sanitize_log_content};
pub use metrics::MetricsRegistry;
pub use selftest::{DiagnosticsHarness, SelftestItemResult, SelftestReport, SelftestScope};
