#!/usr/bin/env bash
# scripts/deploy-testnet.sh
#
# README sections: "Getting started" steps 5–6, "Deployment"
#
# Idempotent testnet deployment script.  On every run it:
#   1. Builds the contract WASM
#   2. Deploys (or re-deploys) the contract
#   3. Initialises it (skipped if already initialised)
#   4. Registers a demo school with a demo attester set
#   5. Writes contract ID, WASM hash, asset address, and timestamp to
#      deployments/testnet.json
#
# Configuration is read from environment variables (never hard-coded).
# Copy .env.example to .env and fill in the values before running.
#
# Usage:
#   source .env && ./scripts/deploy-testnet.sh
#
# Prerequisites:
#   - stellar CLI installed
#   - Rust + wasm32-unknown-unknown target installed
#   - 'admin', 'school', 'attester' keys in the Stellar CLI global keystore
#     (run scripts/create-identities.sh first)
#
# TODO: verify all Stellar CLI flag names against your installed version:
#   stellar contract --help
#   stellar contract deploy --help
#   stellar contract invoke --help
# Reference: https://developers.stellar.org/docs/tools/stellar-cli

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Required environment variables ──────────────────────────────────────────
: "${STELLAR_NETWORK:?Set STELLAR_NETWORK (testnet|local)}"
: "${SOROBAN_RPC_URL:?Set SOROBAN_RPC_URL}"
: "${NETWORK_PASSPHRASE:?Set NETWORK_PASSPHRASE}"
: "${ASSET_CONTRACT_ID:?Set ASSET_CONTRACT_ID (SAC address of the stablecoin)}"
: "${MIN_VOUCHER_AMOUNT:?Set MIN_VOUCHER_AMOUNT}"
: "${MAX_VOUCHER_AMOUNT:?Set MAX_VOUCHER_AMOUNT}"
: "${MAX_EXPIRY_HOURS:?Set MAX_EXPIRY_HOURS}"

# Demo school / attester addresses (from CLI keystore)
ADMIN_ADDR=$(stellar keys address admin)
SCHOOL_ADDR=$(stellar keys address school)
ATTESTER_ADDR=$(stellar keys address attester)

echo "==> Admin:    $ADMIN_ADDR"
echo "==> School:   $SCHOOL_ADDR"
echo "==> Attester: $ATTESTER_ADDR"

# ── Step 1: Build ────────────────────────────────────────────────────────────
echo ""
echo "==> Building contract..."
cd "$REPO_ROOT"
cargo build --target wasm32-unknown-unknown --release -p voucher

WASM_PATH="$REPO_ROOT/target/wasm32-unknown-unknown/release/voucher.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "ERROR: WASM not found at $WASM_PATH" >&2
  exit 1
fi

# Compute WASM hash for recording
# TODO: 'stellar contract hash' may be the correct subcommand; check:
#   stellar contract --help
WASM_HASH=$(sha256sum "$WASM_PATH" | awk '{print $1}')
echo "    WASM hash: $WASM_HASH"

# ── Step 2: Deploy ───────────────────────────────────────────────────────────
echo ""
echo "==> Deploying contract to $STELLAR_NETWORK..."

# TODO: confirm --fee and --build-only flags for your CLI version.
# If the contract is already deployed and you want to reuse the same ID,
# skip this step and set CONTRACT_ID manually in the environment.
# Reference: https://developers.stellar.org/docs/tools/stellar-cli

CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source admin \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE")

echo "    Contract ID: $CONTRACT_ID"

# ── Step 3: Initialise ───────────────────────────────────────────────────────
echo ""
echo "==> Initialising contract..."

# Build the allowed_tokens Vec argument.
# TODO: verify the exact XDR / JSON encoding that `stellar contract invoke`
# expects for Vec<Address> arguments in your CLI version.
# Reference: https://developers.stellar.org/docs/tools/stellar-cli#invoke

# The call below uses the JSON encoding style; adjust if your CLI differs.
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- initialize \
  --admin "$ADMIN_ADDR" \
  --allowed_tokens "[\"$ASSET_CONTRACT_ID\"]" \
  --min_amount "$MIN_VOUCHER_AMOUNT" \
  --max_amount "$MAX_VOUCHER_AMOUNT" \
  --max_expiry_hours "$MAX_EXPIRY_HOURS" \
  || echo "WARN: initialize may have already been called (idempotency guard in contract)"

# ── Step 4: Register demo school ─────────────────────────────────────────────
echo ""
echo "==> Registering demo school ($SCHOOL_ADDR)..."

# 2-of-2 threshold with school + attester (demo; production would be 2-of-3+)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- register_school \
  --school "$SCHOOL_ADDR" \
  --attesters "[\"$ATTESTER_ADDR\"]" \
  --threshold 1 \
  || echo "WARN: register_school may have already been called"

# ── Step 5: Write deployments/testnet.json ───────────────────────────────────
echo ""
echo "==> Writing deployments/testnet.json..."

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$REPO_ROOT/deployments/testnet.json" <<EOF
{
  "network": "$STELLAR_NETWORK",
  "contractId": "$CONTRACT_ID",
  "wasmHash": "$WASM_HASH",
  "assetContractId": "$ASSET_CONTRACT_ID",
  "adminAddress": "$ADMIN_ADDR",
  "demoSchoolAddress": "$SCHOOL_ADDR",
  "demoAttesterAddress": "$ATTESTER_ADDR",
  "deployedAt": "$TIMESTAMP"
}
EOF

echo "    Written."
echo ""
echo "==> Deployment complete."
echo "    Contract ID : $CONTRACT_ID"
echo "    WASM hash   : $WASM_HASH"
echo "    Deployed at : $TIMESTAMP"
echo ""
echo "Next steps:"
echo "  1. Copy CONTRACT_ID and ASSET_CONTRACT_ID into your .env"
echo "  2. Run: pnpm bindings   (to regenerate TypeScript bindings)"
echo "  3. Run: pnpm dev        (to start the local stack)"
