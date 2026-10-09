#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Alpha-Flip v3.2 - Deterministic Replay Driver Script
# Usage: ./scripts/replay_day.sh <path_to_replay_jsonl> [mode: OBSERVE|SHADOW]
# ==============================================================================

REPLAY_FILE="${1:-fixtures/sample_replay.jsonl}"
MODE="${2:-SHADOW}"

echo "============================================================"
echo " Starting Alpha-Flip v3.2 Replay Runner"
echo " Target File: ${REPLAY_FILE}"
echo " Mode:        ${MODE}"
echo " Local Clock: Deterministic Slot Progression"
echo "============================================================"

if [ ! -f "${REPLAY_FILE}" ]; then
    echo "Notice: File ${REPLAY_FILE} not found. Running replay test suite..."
    cargo test --test replay_tests -- --nocapture
    cargo test --test shadow_tests -- --nocapture
    exit 0
fi

cargo run --bin alpha-flip-hot -- --replay "${REPLAY_FILE}" --mode "${MODE}"
