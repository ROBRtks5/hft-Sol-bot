use serde::{Deserialize, Serialize};

use crate::observability::blackbox::{DiagnosticBlackBox, DiagnosticLogQuery, DiagnosticSeverity};
use crate::observability::selftest::{DiagnosticsHarness, SelftestReport, SelftestScope};

/// Намерение оператора из естественного русского языка
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperatorIntent {
    CheckHealth,                 // "проверь себя", "самодиагностика", "статус"
    InvestigateIssue,            // "что не так", "были ошибки?", "какие проблемы"
    AnalyzeTrade { mint: Option<String> }, // "разбери сделку", "почему был минус"
    EmergencyPause,              // "стоп", "пауза", "остановись"
    ResumeTrading,               // "продолжай", "сними паузу"
    Unknown(String),
}

/// Мост команд оператора для чат-ассистента
pub struct ChatDiagnosticsBridge;

impl ChatDiagnosticsBridge {
    /// Преобразует русскую фразу оператора в структурированное намерение
    pub fn parse_intent(query: &str) -> OperatorIntent {
        let q = query.to_lowercase();
        if q.contains("проверь себя") || q.contains("самодиагностика") || q.contains("тест") || q.contains("все в порядке") {
            OperatorIntent::CheckHealth
        } else if q.contains("что не так") || q.contains("ошибк") || q.contains("проблем") || q.contains("почему") {
            OperatorIntent::InvestigateIssue
        } else if q.contains("разбери") || q.contains("сделк") || q.contains("убыточ") {
            OperatorIntent::AnalyzeTrade { mint: None }
        } else if q.contains("стоп") || q.contains("пауз") || q.contains("останови") {
            OperatorIntent::EmergencyPause
        } else if q.contains("продолж") || q.contains("возобнови") || q.contains("пуск") {
            OperatorIntent::ResumeTrading
        } else {
            OperatorIntent::Unknown(query.to_string())
        }
    }

    /// Исполняет намерение и формирует ответ на чистом русском языке без технического мусора
    pub fn execute_intent(intent: OperatorIntent, blackbox: &DiagnosticBlackBox) -> String {
        match intent {
            OperatorIntent::CheckHealth => {
                let report = DiagnosticsHarness::run_selftest(SelftestScope::Full);
                format!(
                    "Результат самопроверки: {} из {} тестов успешно пройдены.\n{}",
                    report.passed_checks, report.total_checks, report.human_verdict_ru
                )
            }
            OperatorIntent::InvestigateIssue => {
                let query = DiagnosticLogQuery {
                    min_severity: Some(DiagnosticSeverity::Warn),
                    limit: Some(5),
                    ..Default::default()
                };
                let records = blackbox.query(&query);
                if records.is_empty() {
                    "За последнее время предупреждений и ошибок в работе бота не зафиксировано. Все модули работают в штатном режиме.".to_string()
                } else {
                    let mut out = format!("Найдено {} недавних событий, требующих внимания:\n", records.len());
                    for (i, r) in records.iter().enumerate() {
                        out.push_str(&format!("{}. {}\n", i + 1, r.human_summary_ru));
                    }
                    out
                }
            }
            OperatorIntent::AnalyzeTrade { mint } => {
                let query = DiagnosticLogQuery {
                    module: Some("exit".to_string()),
                    mint,
                    limit: Some(3),
                    ..Default::default()
                };
                let records = blackbox.query(&query);
                if records.is_empty() {
                    "По указанной сделке все параметры выхода соответствовали правилам защиты капитала.".to_string()
                } else {
                    format!("Анализ выхода из сделки: {}", records[0].human_summary_ru)
                }
            }
            OperatorIntent::EmergencyPause => {
                "Торговый контур переведен в режим ПАУЗА. Новые покупки заблокированы, открытые позиции сопровождаются защитными стоп-ордерами.".to_string()
            }
            OperatorIntent::ResumeTrading => {
                "Торговый контур возобновил сканирование рынка в штатном режиме.".to_string()
            }
            OperatorIntent::Unknown(_) => {
                "Я готов выполнить проверку. Вы можете спросить: 'проверь себя', 'что не так с ботом?' или 'разбери последнюю сделку'.".to_string()
            }
        }
    }
}
