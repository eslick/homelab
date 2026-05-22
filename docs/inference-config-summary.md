# Inference Stack — Configuration & Performance Summary

**Hardware**: 2× RTX 3090 24GB GDDR6X (TP=2, PCIe 4.0, no NVLink), Ubuntu 24.04  
**Runtimes**: vLLM (port 8081) · SGLang (port 8082)  
**Last updated**: 2026-04-24

---

## Runtime Overview

| Runtime | Image | Port | Status | Notes |
|---------|-------|------|--------|-------|
| vLLM | `vllm/vllm-openai:gemma4` | 8081 | **Production** | FlashInfer, chunked prefill, prefix cache |
| SGLang | `lmsysorg/sglang:gemma4` | 8082 | **Blocked** | Marlin/Qwen3.6 bugs; not usable for current models |

Both claim all GPUs — stop one before starting the other:
```bash
docker compose -f /opt/compose/vllm/docker-compose.yml down   # before starting SGLang
docker compose -f /opt/compose/sglang/docker-compose.yml down  # before starting vLLM
```

---

## Runtime Comparison — Qwen3-30B-A3B-AWQ (apples-to-apples)

*Source: `docs/inference-runtime-report.md` — identical model, ~230-word prompt, 300 tokens*

| Runtime | TTFT (warm) | Decode tok/s | Total time | KV cache |
|---------|-------------|--------------|------------|----------|
| **SGLang v0.5.10.post1** | **84 ms** | **188.9** | **1.7 s** | fp8_e4m3 |
| vLLM gemma4 image | 179 ms | 168.0 | 2.0 s | fp8 |

SGLang: −53% TTFT, +12% decode throughput. RadixAttention advantage is largest on diverse/novel prompts.

---

## Model Benchmark Summary — vLLM (2026-04-24)

*Source: `docs/benchmark-2026-04-24.md` — 300 output tokens, concurrency=4*

| Model | KV cache | TTFT warm | Fill rate | Decode (1-user) | Decode (4× agg.) | Cache hit | Max ctx |
|-------|----------|-----------|-----------|-----------------|-------------------|-----------|---------|
| Gemma 4 27B AWQ (A4B) | BF16 (fp8 blocked) | 37 ms | 8,100 ptok/s | 123.5 tok/s | 229.4 tok/s | 1.5× | 16,384 |
| Qwen3.6-35B AWQ (A3B) | fp8 | 84 ms | 3,607 ptok/s | 154.4 tok/s | **415.6 tok/s** | **3.3×** | 32,768 |
| gpt-oss-20b MXFP4 | BF16 | 6,220 ms† | 56 ptok/s | **209.5 tok/s** | 100.0 tok/s‡ | 1.2× | 16,384 |

† gpt-oss-20b: TTFT is time to first *content* token after ~6.2s thinking phase.  
‡ 2/4 workers exhaust token budget on thinking tokens at concurrency=4; use `max_tokens ≥ 4000`.

---

## Active Model Configurations

### Gemma 4 27B AWQ (A4B) — default
```
-e vllm_model_id=cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit
-e vllm_served_model_name=gemma4-27b
-e vllm_image=vllm/vllm-openai:gemma4
```
- Weights: ~14–16 GB across both cards  
- KV cache: BF16 required (fp8e4nv unsupported on Ampere/RTX 3090)  
- max_model_len: 63,488 (confirmed stable; fp8 support on H100+ would extend to 64k+)  
- max_num_seqs: 16 (reduced for 128k KV footprint)

### Gemma 4 27B AWQ (A3B) — fewer active params
```
-e vllm_model_id=cyankiwi/gemma-4-26B-A3B-it-AWQ-4bit
-e vllm_served_model_name=gemma4-27b-a3b
-e vllm_image=vllm/vllm-openai:gemma4
```
- Same total weight size; ~3B active params vs 4B — lower decode FLOP cost  
- Expect ~10–15% faster decode than A4B  
- KV constraints identical (BF16 required on Ampere)  
- max_num_seqs: 16 (same constraint)

### Qwen3.6-35B AWQ (A3B) — best multi-user throughput
```
-e vllm_model_id=QuantTrio/Qwen3.6-35B-A3B-AWQ
-e vllm_served_model_name=qwen3.6-35b-a3b
-e vllm_image=vllm/vllm-openai:gemma4
-e vllm_max_model_len=65536
-e "vllm_extra_args=--max-num-batched-tokens 4096"
```
- fp8 KV works (unlike Gemma 4 on Ampere)  
- Strongest prefix cache benefit (3.3×)  
- 415.6 tok/s at 4× concurrency — best throughput tested  
- Requires `--max-num-batched-tokens 4096` (hybrid Mamba block_size=2096)

### gpt-oss-20b MXFP4 — fastest single-user decode
```
-e vllm_model_id=openai/gpt-oss-20b
-e vllm_served_model_name=gpt-oss-20b
-e vllm_image=vllm/vllm-openai:latest
-e vllm_max_model_len=32768
```
- 209.5 tok/s single-user — fastest tested  
- Reasoning model: set `max_tokens ≥ 4000`; ~1,307 thinking tokens per request  
- Concurrency degrades unless thinking budget is accounted for  

---

## Compatibility Matrix

| Model | vLLM | SGLang | Blocker |
|-------|------|--------|---------|
| Gemma 4 27B AWQ (A4B) | ✓ (BF16 KV) | ✗ | Marlin tile 4304 not divisible by 64 |
| Gemma 4 27B AWQ (A3B) | ✓ (BF16 KV) | ✗ | Same Marlin bug applies |
| Qwen3.6-35B AWQ | ✓ (fp8 KV) | ✗ | Weight key mismatch in qwen3_5.py loader |
| Qwen3-30B AWQ | ✓ | ✓ | — |
| gpt-oss-20b MXFP4 | ✓ | untested | — |

---

## Ampere (RTX 3090) Constraints

- **fp8 KV cache**: software-emulated; halves VRAM for KV at negligible quality cost. Blocked for Gemma 4 (fp8e4nv unsupported — Triton attn kernel requires H100+).
- **PCIe TP=2**: ~20–40% throughput penalty vs NVLink on decode-bound workloads. Keep `max_num_seqs` in check.
- **MXFP4 weights**: supported via Marlin on Ampere (gpt-oss-20b works out of the box).

---

## Workload Recommendations

| Use case | Model | Why |
|----------|-------|-----|
| Multi-user / tool use | Qwen3.6-35B (A3B) | 415 agg tok/s, 3.3× cache hit, 32k ctx |
| Coding / reasoning | gpt-oss-20b | 209 tok/s, near-o4-mini quality |
| General / long context | Gemma 4 27B A3B | Good TTFT, lighter decode than A4B |
| SGLang (when fixed) | Qwen3-30B or Qwen3.6 | SGLang wins on TTFT for Qwen line |
