use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, RwLock};

use crate::types::{Mint, Slot};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    Debug,
    Info,
    Warn,
    Error,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticEventRecord {
    pub id: u64,
    pub timestamp_utc: String,
    pub slot: u64,
    pub module: String,
    pub kind: String,
    pub severity: DiagnosticSeverity,
    pub mint: Option<String>,
    pub tech_fields: serde_json::Value,
    /// Человеческое описание на русском языке для оператора и чат-ассистента
    pub human_summary_ru: String,
}

#[derive(Debug, Clone, Default)]
pub struct DiagnosticLogQuery {
    pub module: Option<String>,
    pub min_severity: Option<DiagnosticSeverity>,
    pub mint: Option<String>,
    pub start_slot: Option<u64>,
    pub limit: Option<usize>,
}

/// Кольцевой буфер черного ящика диагностики с потокобезопасным доступом
pub struct DiagnosticBlackBox {
    buffer: RwLock<VecDeque<DiagnosticEventRecord>>,
    capacity: usize,
    counter: std::sync::atomic::AtomicU64,
}

impl DiagnosticBlackBox {
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: RwLock::new(VecDeque::with_capacity(capacity)),
            capacity,
            counter: std::sync::atomic::AtomicU64::new(1),
        }
    }

    /// Записать диагностическое событие в черный ящик
    pub fn record(
        &self,
        slot: Slot,
        module: &str,
        kind: &str,
        severity: DiagnosticSeverity,
        mint: Option<Mint>,
        tech_fields: serde_json::Value,
        human_summary_ru: impl Into<String>,
    ) -> DiagnosticEventRecord {
        let id = self.counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let now = Utc::now().to_rfc3339();

        let record = DiagnosticEventRecord {
            id,
            timestamp_utc: now,
            slot: slot.as_u64(),
            module: module.to_string(),
            kind: kind.to_string(),
            severity,
            mint: mint.map(|m| m.to_string()),
            tech_fields,
            human_summary_ru: human_summary_ru.into(),
        };

        let mut buf = self.buffer.write().unwrap();
        if buf.len() >= self.capacity {
            buf.pop_front();
        }
        buf.push_back(record.clone());

        record
    }

    /// Поиск событий по фильтрам (модуль, критичность, токен, окно)
    pub fn query(&self, query: &DiagnosticLogQuery) -> Vec<DiagnosticEventRecord> {
        let buf = self.buffer.read().unwrap();
        let limit = query.limit.unwrap_or(50);

        buf.iter()
            .rev()
            .filter(|rec| {
                if let Some(ref m) = query.module {
                    if &rec.module != m {
                        return false;
                    }
                }
                if let Some(min_sev) = query.min_severity {
                    if rec.severity < min_sev {
                        return false;
                    }
                }
                if let Some(ref mint) = query.mint {
                    if rec.mint.as_deref() != Some(mint.as_str()) {
                        return false;
                    }
                }
                if let Some(start) = query.start_slot {
                    if rec.slot < start {
                        return false;
                    }
                }
                true
            })
            .take(limit)
            .cloned()
            .collect()
    }

    /// Проверка наличия критических сбоев (CRITICAL)
    pub fn has_unresolved_critical(&self) -> bool {
        let buf = self.buffer.read().unwrap();
        buf.iter().any(|r| r.severity == DiagnosticSeverity::Critical)
    }

    /// Получить последние события на понятном русском языке
    pub fn recent_human_summaries(&self, limit: usize) -> Vec<String> {
        let buf = self.buffer.read().unwrap();
        buf.iter()
            .rev()
            .take(limit)
            .map(|r| format!("[Слот {} | {:?}] {}", r.slot, r.severity, r.human_summary_ru))
            .collect()
    }
}
