#!/usr/bin/env bash
# run-benchmarks.sh — Full inference benchmark suite
#
# Runs each model/runtime combination in sequence, benchmarking:
#   sequential TTFT, fill rate, decode throughput, TTS
#   concurrency (N parallel requests: P50/P95/P99 TTFT, aggregate throughput)
#   cache performance (cold vs warm prefix cache)
#   context length probe (find hardware ceiling)
#
# Results appended to docs/benchmark-YYYY-MM-DD.md
#
# Usage:
#   ./files/run-benchmarks.sh                  # full suite
#   ./files/run-benchmarks.sh gemma4-vllm      # single target
#
# Targets: gemma4-vllm  gemma4-sglang  qwen36-sglang  gpt-oss-vllm

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BENCH="$REPO/files/benchmark-inference.py"
OUT="$REPO/docs/benchmark-$(date +%Y-%m-%d).md"
RUNS=3
MAX_TOKENS=300
CONCURRENCY=4
VLLM_URL="http://127.0.0.1:8081"
SGLANG_URL="http://127.0.0.1:8082"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }

die() { log "ERROR: $*"; exit 1; }

wait_healthy() {
    local url="$1/health" elapsed=0
    log "Waiting for $url ..."
    until curl -sf "$url" >/dev/null 2>&1; do
        sleep 10; elapsed=$((elapsed + 10))
        [[ $elapsed -ge 600 ]] && die "health check timed out (600s) for $url"
    done
    log "Server healthy."
}

deploy_vllm() {
    local model_id="$1" served="$2" image="${3:-vllm/vllm-openai:gemma4}" max_len="${4:-65536}"
    log "Deploying vLLM: $served ($model_id) image=$image max_len=$max_len"
    ansible-playbook "$REPO/playbooks/vllm.yml" \
        -e "vllm_model_id=$model_id" \
        -e "vllm_served_model_name=$served" \
        -e "vllm_image=$image" \
        -e "vllm_max_model_len=$max_len" \
        --tags docker,configure
    wait_healthy "$VLLM_URL"
}

deploy_sglang() {
    local model_id="$1" served="$2" image="${3:-lmsysorg/sglang:gemma4}" max_len="${4:-65536}"
    log "Deploying SGLang: $served ($model_id) image=$image max_len=$max_len"
    ansible-playbook "$REPO/playbooks/sglang.yml" \
        -e "sglang_model_id=$model_id" \
        -e "sglang_served_model_name=$served" \
        -e "sglang_image=$image" \
        -e "sglang_max_model_len=$max_len" \
        --tags docker,configure
    wait_healthy "$SGLANG_URL"
}

bench() {
    local url="$1" model="$2" label="$3"
    python3 "$BENCH" \
        --url "$url" \
        --model "$model" \
        --label "$label" \
        --runs "$RUNS" \
        --max-tokens "$MAX_TOKENS" \
        --concurrency "$CONCURRENCY" \
        --cache-test \
        --probe-context \
        | tee -a "$OUT"
}

run_gemma4_vllm() {
    log "=== Gemma 4 27B on vLLM ==="
    deploy_vllm "cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit" "gemma4-27b" "vllm/vllm-openai:gemma4" 65536
    printf '\n---\n\n' >> "$OUT"
    bench "$VLLM_URL" "gemma4-27b" "Gemma 4 27B AWQ — vLLM"
}

run_gemma4_sglang() {
    log "=== Gemma 4 27B on SGLang ==="
    deploy_sglang "cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit" "gemma4-27b" "lmsysorg/sglang:gemma4" 65536
    printf '\n---\n\n' >> "$OUT"
    bench "$SGLANG_URL" "gemma4-27b" "Gemma 4 27B AWQ — SGLang"
}

run_qwen36_sglang() {
    log "=== Qwen3.6-35B on SGLang ==="
    deploy_sglang "QuantTrio/Qwen3.6-35B-A3B-AWQ" "qwen3.6-35b-a3b" "lmsysorg/sglang:v0.5.10.post1" 65536
    printf '\n---\n\n' >> "$OUT"
    bench "$SGLANG_URL" "qwen3.6-35b-a3b" "Qwen3.6-35B AWQ — SGLang"
}

run_gpt_oss_vllm() {
    log "=== gpt-oss-20b on vLLM ==="
    # gpt-oss-20b uses native MXFP4 quant; vllm:latest has Ampere fallback support (PR #22259).
    # If MXFP4 kernels are unavailable it dequantizes to BF16 (~42GB) — fits TP=2 across 48GB.
    deploy_vllm "openai/gpt-oss-20b" "gpt-oss-20b" "vllm/vllm-openai:latest" 32768
    printf '\n---\n\n' >> "$OUT"
    bench "$VLLM_URL" "gpt-oss-20b" "gpt-oss-20b — vLLM"
}

# ── Entry point ───────────────────────────────────────────────────────────────

TARGET="${1:-all}"

{
    echo "# Inference Benchmark Results — $(date '+%Y-%m-%d')"
    echo ""
    echo "**Hardware**: 2× RTX 3090 24GB GDDR6X, TP=2, fp8 KV cache, PCIe 4.0 (no NVLink)"
    echo "**Script**: \`files/benchmark-inference.py\`  runs=$RUNS  max_tokens=$MAX_TOKENS  concurrency=$CONCURRENCY"
    echo ""
} > "$OUT"

case "$TARGET" in
    gemma4-vllm)   run_gemma4_vllm ;;
    gemma4-sglang) run_gemma4_sglang ;;
    qwen36-sglang) run_qwen36_sglang ;;
    gpt-oss-vllm)  run_gpt_oss_vllm ;;
    all)
        run_gemma4_vllm
        run_gemma4_sglang
        run_qwen36_sglang
        run_gpt_oss_vllm
        ;;
    *) die "Unknown target '$TARGET'. Options: all gemma4-vllm gemma4-sglang qwen36-sglang gpt-oss-vllm" ;;
esac

log "Done. Results: $OUT"
