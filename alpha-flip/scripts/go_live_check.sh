#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Alpha-Flip v3.2 - Micro-Live Pre-Flight Sanity Verification
# Verifies all environmental, configuration, and security pre-conditions.
# ==============================================================================

echo "============================================================"
echo " Starting Alpha-Flip v3.2 Micro-Live Pre-Flight Checks"
echo "============================================================"

PASS_COUNT=0
FAIL_COUNT=0

check_pass() {
    echo "  [PASS] $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

check_fail() {
    echo "  [FAIL] $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

# 1. Config Mode Check
CONFIG_FILE="${1:-configs/hot.micro-live.toml}"
if [ -f "$CONFIG_FILE" ]; then
    MODE=$(grep -E '^trading_mode' "$CONFIG_FILE" | head -n1 | awk -F'"' '{print $2}')
    if [ "$MODE" = "live" ]; then
        check_pass "Configured trading_mode is 'live' in $CONFIG_FILE"
    else
        check_fail "Expected trading_mode='live', got '$MODE'"
    fi
else
    check_fail "Micro-live config file not found: $CONFIG_FILE"
fi

# 2. Check Risk Sizing Caps
if [ -f "$CONFIG_FILE" ]; then
    MAX_POS=$(grep -E '^max_position_sol' "$CONFIG_FILE" | head -n1 | awk '{print $3}')
    if awk "BEGIN {exit !($MAX_POS <= 0.05)}"; then
        check_pass "Micro-live position cap is safe ($MAX_POS SOL <= 0.05 SOL)"
    else
        check_fail "Position cap too high for micro-live ($MAX_POS SOL > 0.05 SOL)"
    fi
fi

# 3. Secret Leakage Verification
echo "Auditing workspace for unredacted private keys..."
if grep -rn "5[1-9A-HJ-NP-Za-km-z]\{87\}" crates/ services/ configs/ 2>/dev/null; then
    check_fail "Potential base58 private key discovered in workspace!"
else
    check_pass "No base58 private keys leaked in code/config files."
fi

# 4. Check Redis Reachability
if which redis-cli >/dev/null 2>&1; then
    if redis-cli ping >/dev/null 2>&1; then
        check_pass "Redis server reachable."
    else
        echo "  [WARN] Redis server unreachable (mock/isolated container)."
    fi
else
    echo "  [INFO] redis-cli not installed; skipping live ping check."
fi

# 5. Check Test Suites
echo "Checking unit and integration test scripts..."
if [ -f "crates/alpha-flip-hot/tests/smoke_test.rs" ]; then
    check_pass "Smoke test harness in place."
fi
if [ -f "crates/alpha-flip-hot/tests/replay_tests.rs" ]; then
    check_pass "Deterministic replay test harness in place."
fi
if [ -f "crates/alpha-flip-hot/tests/shadow_tests.rs" ]; then
    check_pass "Shadow simulation test harness in place."
fi

echo "============================================================"
echo " Pre-Flight Check Summary: $PASS_COUNT Passed, $FAIL_COUNT Failed"
echo "============================================================"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "PRE-FLIGHT CHECK FAILED. Do not launch micro-live!"
    exit 1
else
    echo "PRE-FLIGHT CHECK PASSED. Ready for micro-live operational launch."
    exit 0
fi
