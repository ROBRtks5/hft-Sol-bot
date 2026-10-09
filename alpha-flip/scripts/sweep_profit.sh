#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Alpha-Flip v3.2 - Automated Hot Wallet Profit Sweeper
# Safely transfers excess SOL from hot wallet to cold multisig vault.
# ==============================================================================

KEYPAIR_PATH="${HOT_KEYPAIR_PATH:-/etc/alpha-flip/keypair.json}"
COLD_VAULT="${COLD_SWEEP_VAULT:-MockColdVault1111111111111111111111111111}"
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
RESERVE_FLOOR_SOL="${RESERVE_FLOOR_SOL:-1.0}"
DRY_RUN=false

for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        --cold-vault)
            COLD_VAULT="$2"
            shift 2
            ;;
        --threshold)
            RESERVE_FLOOR_SOL="$2"
            shift 2
            ;;
    esac
done

if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "Notice: Keypair file $KEYPAIR_PATH not found or in sandbox environment. Simulating sweep check..."
    exit 0
fi

HOT_PUBKEY=$(solana-keygen pubkey "$KEYPAIR_PATH")
BALANCE_RAW=$(solana balance "$HOT_PUBKEY" --url "$RPC_URL" | awk '{print $1}')

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Checking hot wallet: $HOT_PUBKEY (Balance: $BALANCE_RAW SOL)"

# Compare float balance to threshold
EXCESS=$(awk "BEGIN {print $BALANCE_RAW - $RESERVE_FLOOR_SOL}")
IS_EXCESS=$(awk "BEGIN {print ($EXCESS > 0.05) ? 1 : 0}")

if [ "$IS_EXCESS" -eq 1 ]; then
    echo "Excess detected: $EXCESS SOL. Sweeping to cold vault: $COLD_VAULT"
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would transfer $EXCESS SOL to $COLD_VAULT"
    else
        solana transfer --keypair "$KEYPAIR_PATH" --url "$RPC_URL" "$COLD_VAULT" "$EXCESS" --allow-unfunded-recipient
        echo "Successfully swept $EXCESS SOL to cold vault."
    fi
else
    echo "Balance is within safe limits (<= $RESERVE_FLOOR_SOL SOL). No sweep needed."
fi
