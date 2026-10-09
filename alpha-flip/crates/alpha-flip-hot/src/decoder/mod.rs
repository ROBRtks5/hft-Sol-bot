pub mod fixtures;
pub mod inner_instruction_selector;
pub mod log_prefilter;
pub mod pump_fun;
pub mod raydium;
pub mod registry;
pub mod token_2022;

pub use inner_instruction_selector::{InnerInstructionSelector, SelectedInnerInstruction};
pub use log_prefilter::{LogPrefilter, LogPrefilterResult};
pub use pump_fun::{
    PumpCreateDecoded, PumpFunDecoder, PumpInstructionDecoded, PumpMigrateDecoded, PumpTradeDecoded,
};
pub use raydium::{
    RaydiumDecoder, RaydiumInstructionDecoded, RaydiumPoolCreatedDecoded, RaydiumSwapDecoded,
};
pub use registry::{KnownProgram, ProgramRegistration, ProgramRegistry};
pub use token_2022::{Token2022Parser, Token2022RiskInspection};

use crate::grpc::transport::TransactionUpdateFrame;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tracing::warn;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DecodedInstructionEvent {
    PumpCreate(PumpCreateDecoded),
    PumpTrade(PumpTradeDecoded),
    PumpMigrate(PumpMigrateDecoded),
    RaydiumPool(RaydiumPoolCreatedDecoded),
    RaydiumSwap(RaydiumSwapDecoded),
}

/// Atomic lock-free latency and event counters for the decoder pipeline
#[derive(Debug, Default)]
pub struct DecoderMetrics {
    pub decoded_events_total: AtomicU64,
    pub skipped_unknown_program_total: AtomicU64,
    pub skipped_failed_tx_total: AtomicU64,
    pub ambiguous_signer_total: AtomicU64,
    pub decode_latency_micros_accum: AtomicU64,
    pub decode_samples_count: AtomicU64,
}

impl DecoderMetrics {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn record_latency(&self, elapsed_micros: u64) {
        self.decode_latency_micros_accum.fetch_add(elapsed_micros, Ordering::Relaxed);
        self.decode_samples_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn avg_latency_micros(&self) -> u64 {
        let count = self.decode_samples_count.load(Ordering::Relaxed);
        if count == 0 {
            0
        } else {
            self.decode_latency_micros_accum.load(Ordering::Relaxed) / count
        }
    }
}

/// High-throughput log-gated selective instruction decoder engine
pub struct InstructionDecoder {
    registry: ProgramRegistry,
    metrics: Arc<DecoderMetrics>,
}

impl Default for InstructionDecoder {
    fn default() -> Self {
        Self::new(ProgramRegistry::new())
    }
}

impl InstructionDecoder {
    pub fn new(registry: ProgramRegistry) -> Self {
        Self {
            registry,
            metrics: DecoderMetrics::new(),
        }
    }

    pub fn metrics(&self) -> Arc<DecoderMetrics> {
        self.metrics.clone()
    }

    pub fn registry(&self) -> &ProgramRegistry {
        &self.registry
    }

    /// Primary fast-filter pipeline enforcing the exact evaluation order:
    /// 1. Transaction success check (failed txs skipped immediately)
    /// 2. Program ID presence check (unknown programs skipped immediately)
    /// 3. Account key presence
    /// 4. Logs prefilter (zero-alloc slice scan)
    /// 5. Instruction discriminator decode (binary unpack)
    pub fn decode_transaction(
        &self,
        tx: &TransactionUpdateFrame,
    ) -> Vec<DecodedInstructionEvent> {
        let start = Instant::now();
        let mut results = Vec::new();

        // 1. FAST FILTER 1: Transaction success status
        if tx.err.is_some() {
            self.metrics.skipped_failed_tx_total.fetch_add(1, Ordering::Relaxed);
            return results;
        }

        // 2. FAST FILTER 2 & 3: Check program ID and account key presence
        let has_monitored_program = tx
            .instructions
            .iter()
            .any(|inst| self.registry.is_monitored(&inst.program_id))
            || tx.inner_instructions.iter().any(|set| {
                set.instructions
                    .iter()
                    .any(|inst| self.registry.is_monitored(&inst.program_id))
            });

        if !has_monitored_program {
            self.metrics.skipped_unknown_program_total.fetch_add(1, Ordering::Relaxed);
            return results;
        }

        // 3. FAST FILTER 4: Logs prefilter
        let log_scan = LogPrefilter::scan(&tx.log_messages);
        if !log_scan.should_decode && !tx.instructions.is_empty() {
            return results;
        }

        let primary_signer = tx.account_keys.first().copied();

        // 4. Decode top-level instructions
        for inst in &tx.instructions {
            if let Some(known) = self.registry.classify(&inst.program_id) {
                match known {
                    KnownProgram::PumpFun => {
                        if let Some(pump_inst) = PumpFunDecoder::decode_instruction(
                            inst,
                            &tx.inner_instructions,
                            tx.slot,
                            tx.signature,
                            primary_signer,
                        ) {
                            match pump_inst {
                                PumpInstructionDecoded::Create(c) => {
                                    results.push(DecodedInstructionEvent::PumpCreate(c));
                                    self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                                }
                                PumpInstructionDecoded::Trade(t) => {
                                    results.push(DecodedInstructionEvent::PumpTrade(t));
                                    self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                                }
                                PumpInstructionDecoded::Migrate(m) => {
                                    results.push(DecodedInstructionEvent::PumpMigrate(m));
                                    self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                                }
                                PumpInstructionDecoded::Unknown(disc) => {
                                    warn!(discriminator = ?disc, "Unknown Pump.fun discriminator skipped");
                                }
                            }
                        }
                    }
                    KnownProgram::RaydiumAmmV4 => {
                        if let Some(ray_inst) = RaydiumDecoder::decode_instruction(
                            inst,
                            tx.slot,
                            tx.signature,
                            primary_signer,
                        ) {
                            match ray_inst {
                                RaydiumInstructionDecoded::PoolCreated(p) => {
                                    results.push(DecodedInstructionEvent::RaydiumPool(p));
                                    self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                                }
                                RaydiumInstructionDecoded::Swap(s) => {
                                    results.push(DecodedInstructionEvent::RaydiumSwap(s));
                                    self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                                }
                                RaydiumInstructionDecoded::LiquidityChange { .. } => {}
                                RaydiumInstructionDecoded::Unknown(disc) => {
                                    warn!(discriminator = disc, "Unknown Raydium discriminator skipped");
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        // 5. Decode relevant inner instructions (CPI via routers)
        let inner_selected = InnerInstructionSelector::select_relevant_cpi(
            &tx.inner_instructions,
            &tx.account_keys,
            &self.registry,
        );

        for inner in inner_selected {
            if inner.is_ambiguous {
                self.metrics.ambiguous_signer_total.fetch_add(1, Ordering::Relaxed);
            }

            match inner.target_program {
                KnownProgram::PumpFun => {
                    if let Some(PumpInstructionDecoded::Trade(trade)) =
                        PumpFunDecoder::decode_instruction(
                            &inner.instruction,
                            &[],
                            tx.slot,
                            tx.signature,
                            inner.real_signer,
                        )
                    {
                        results.push(DecodedInstructionEvent::PumpTrade(trade));
                        self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                    }
                }
                KnownProgram::RaydiumAmmV4 => {
                    if let Some(RaydiumInstructionDecoded::Swap(swap)) =
                        RaydiumDecoder::decode_instruction(
                            &inner.instruction,
                            tx.slot,
                            tx.signature,
                            inner.real_signer,
                        )
                    {
                        results.push(DecodedInstructionEvent::RaydiumSwap(swap));
                        self.metrics.decoded_events_total.fetch_add(1, Ordering::Relaxed);
                    }
                }
                _ => {}
            }
        }

        let elapsed = start.elapsed().as_micros() as u64;
        self.metrics.record_latency(elapsed);

        results
    }
}
