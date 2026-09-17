#!/usr/bin/env bash
set -euo pipefail

# Re-encode release WASM contracts for compatibility with Soroban's WASM VM.
#
# Modern rustc/LLD (confirmed: rustc 1.98.1, and reproduced back to at least
# 1.88.0 — going further back hits an MSRV wall with the current dependency
# graph before reaching a version old enough to predate this) always emits
# the newer post-MVP encoding for the "elem" section backing indirect call
# tables, regardless of `-C target-feature=-reference-types` or
# `-C target-cpu=mvp` passed to rustc — this is an LLD linker default, not a
# rustc codegen feature toggle. soroban-env-host's wasmi validator
# (contracts/../get_wasmi_config in soroban-env-host's wasmi_helper.rs)
# explicitly disables reference-types and rejects that encoding outright
# with "reference-types not enabled: zero byte expected", so every contract
# built with an unpinned "stable" toolchain past this point fails to deploy
# to any real Soroban network (testnet or mainnet) — this is not just a
# test-harness issue.
#
# wasm-opt (Binaryen) can re-encode the module back to a form the disabled
# features don't touch. The feature flags here mirror soroban-env-host's
# get_wasmi_config exactly: bulk-memory and sign-ext stay enabled (Soroban
# allows them); reference-types, tail-call, multivalue, and
# nontrapping-float-to-int are disabled (Soroban rejects them). No
# optimization level is passed — this only fixes encoding, it does not
# change contract behavior. Verified against the real Stellar testnet: a
# wasm-opt-fixed router-core contract deployed and successfully executed
# `initialize` on-chain; the same contract's original build was rejected by
# the RPC node's simulation with the "reference-types not enabled" error
# above.
#
# Requires `wasm-opt` on PATH (from the binaryen package).

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_DIR="$REPO_ROOT/target/wasm32-unknown-unknown/release"

if ! command -v wasm-opt >/dev/null 2>&1; then
    echo "ERROR: wasm-opt not found on PATH. Install binaryen:"
    echo "  https://github.com/WebAssembly/binaryen/releases"
    exit 1
fi

shopt -s nullglob
WASM_FILES=("$WASM_DIR"/*.wasm)
shopt -u nullglob

if [ ${#WASM_FILES[@]} -eq 0 ]; then
    echo "ERROR: no .wasm files found in $WASM_DIR — run the WASM build first."
    exit 1
fi

for wasm_file in "${WASM_FILES[@]}"; do
    name="$(basename "$wasm_file")"
    echo "Fixing $name..."
    wasm-opt "$wasm_file" -o "$wasm_file" \
        --enable-bulk-memory \
        --enable-sign-ext \
        --disable-reference-types \
        --disable-tail-call \
        --disable-multivalue \
        --disable-nontrapping-float-to-int
done

echo ""
echo "Fixed ${#WASM_FILES[@]} contract(s) for Soroban WASM VM compatibility."
