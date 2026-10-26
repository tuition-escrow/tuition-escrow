#!/usr/bin/env bash
# scripts/generate-bindings.sh
#
# README section: "Getting started" step 6
#
# Generates TypeScript bindings from the deployed contract into
# packages/contract-bindings, then builds the package.
#
# Usage:
#   source .env && ./scripts/generate-bindings.sh
#
# Prerequisites:
#   - VOUCHER_CONTRACT_ID set in environment (or .env)
#   - STELLAR_NETWORK set
#   - SOROBAN_RPC_URL set
#   - NETWORK_PASSPHRASE set
#   - stellar CLI installed
#   - pnpm installed
#
# TODO: verify 'stellar contract bindings typescript' flags for your CLI version.
# Reference: https://developers.stellar.org/docs/tools/stellar-cli

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${VOUCHER_CONTRACT_ID:?Set VOUCHER_CONTRACT_ID (from deployments/testnet.json or .env)}"
: "${STELLAR_NETWORK:?Set STELLAR_NETWORK}"
: "${SOROBAN_RPC_URL:?Set SOROBAN_RPC_URL}"
: "${NETWORK_PASSPHRASE:?Set NETWORK_PASSPHRASE}"

OUTPUT_DIR="$REPO_ROOT/packages/contract-bindings"

echo "==> Generating TypeScript bindings..."
echo "    Contract ID  : $VOUCHER_CONTRACT_ID"
echo "    Output dir   : $OUTPUT_DIR"

# TODO: if your CLI version uses different flags (e.g. --output vs --output-dir),
# adjust here.  Check:  stellar contract bindings typescript --help
stellar contract bindings typescript \
  --contract-id "$VOUCHER_CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --output-dir "$OUTPUT_DIR"

echo "==> Building contract-bindings package..."
pnpm --filter @tuition-escrow/contract-bindings build

echo "==> Done.  Bindings written to $OUTPUT_DIR"
