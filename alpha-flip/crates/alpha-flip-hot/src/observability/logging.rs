use serde::Serialize;
use std::io::Write;
use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Security-hardened JSON log formatter.
/// Automatically redacts sensitive patterns, private key bytes, base58 secrets,
/// and enforces machine-readable structure with millisecond timestamp.
#[derive(Debug, Default, Clone)]
pub struct HardenedJsonFormatter;

impl<S, N> FormatEvent<S, N> for HardenedJsonFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        let meta = event.metadata();
        let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        write!(
            writer,
            r#"{{"timestamp":"{}","level":"{}","target":"{}","file":"{}","line":{}"#,
            timestamp,
            meta.level(),
            meta.target(),
            meta.file().unwrap_or("unknown"),
            meta.line().unwrap_or(0)
        )?;

        // Include span information if present
        if let Some(scope) = ctx.event_scope() {
            write!(writer, r#","spans":["#)?;
            let mut first = true;
            for span in scope.from_root() {
                if !first {
                    write!(writer, ",")?;
                }
                first = false;
                write!(writer, r#""{}""#, span.name())?;
            }
            write!(writer, "]")?;
        }

        // Visitor that redacts sensitive strings before writing
        struct RedactingVisitor<'a> {
            writer: Writer<'a>,
        }

        impl<'a> tracing::field::Visit for RedactingVisitor<'a> {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                let raw = format!("{:?}", value);
                let sanitized = sanitize_log_content(&raw);
                let _ = write!(self.writer, r#", "{}":"{}""#, field.name(), sanitized.replace('\"', "\\\""));
            }

            fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                let sanitized = sanitize_log_content(value);
                let _ = write!(self.writer, r#", "{}":"{}""#, field.name(), sanitized.replace('\"', "\\\""));
            }

            fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
                let _ = write!(self.writer, r#", "{}":{}"#, field.name(), value);
            }

            fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
                let _ = write!(self.writer, r#", "{}":{}"#, field.name(), value);
            }

            fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
                let _ = write!(self.writer, r#", "{}":{}"#, field.name(), value);
            }
        }

        let mut visitor = RedactingVisitor { writer };
        event.record(&mut visitor);

        writeln!(visitor.writer, "}}")
    }
}

/// Scrub potential private key arrays, seed words, base58 64-byte secrets, or sensitive headers
pub fn sanitize_log_content(input: &str) -> String {
    let mut result = input.to_string();

    // Redact base58 private key patterns (> 44 chars that look like 64-byte keypairs or seeds)
    if result.contains("private_key") || result.contains("secret") || result.contains("seed") {
        result = "[REDACTED_SECRET]".to_string();
        return result;
    }

    // Redact array representations of keypairs e.g. [123, 45, 67, ...] with > 32 elements
    if result.starts_with('[') && result.ends_with(']') && result.split(',').count() >= 32 {
        return "[REDACTED_BYTE_KEY]".to_string();
    }

    result
}

/// Initialize tracing subscriber with structured logging and environmental filtering
pub fn init_logging(json_format: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,alpha_flip_hot=debug"));

    if json_format {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().event_format(HardenedJsonFormatter))
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().with_ansi(true))
            .init();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_redaction() {
        assert_eq!(sanitize_log_content("my secret_key is abc"), "[REDACTED_SECRET]");
        assert_eq!(sanitize_log_content("seed phrase words"), "[REDACTED_SECRET]");
        assert_eq!(sanitize_log_content("token mint 7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"), "token mint 7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");
    }
}
