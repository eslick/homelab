# Inference Benchmark Results — 2026-04-24

**Hardware**: 2× RTX 3090 24GB GDDR6X, TP=2, PCIe 4.0 (no NVLink), Ubuntu 24.04  
**Script**: `files/benchmark-inference.py`  runs=3  max_tokens=300 (2000 for gpt-oss-20b)  concurrency=4

---

## Summary Table

| Model | Runtime | KV Cache | TTFT warm | Fill rate | Decode tok/s | Concurr. agg. tok/s | Cache speedup | Max ctx |
|-------|---------|----------|-----------|-----------|-------------|---------------------|---------------|---------|
| Gemma 4 27B AWQ | vLLM gemma4 | BF16 (fp8 unsupported) | 37 ms | 8,100 ptok/s | 123.5 tok/s | 229.4 tok/s | 1.5× | 16,384 |
| Gemma 4 27B AWQ | SGLang gemma4 | — | FAILED | — | — | — | — | — |
| Qwen3.6-35B AWQ | vLLM gemma4 | fp8 | 84 ms | 3,607 ptok/s | 154.4 tok/s | 415.6 tok/s | 3.3× | 32,768 |
| Qwen3.6-35B AWQ | SGLang latest | — | FAILED | — | — | — | — | — |
| gpt-oss-20b MXFP4 | vLLM latest | BF16 | 6,220 ms† | 56 ptok/s | 209.5 tok/s | 100.0 tok/s | 1.2× | 16,384 |

† gpt-oss-20b is a reasoning model: TTFT here is time to first *content* token after ~6.2s / ~1,307 thinking tokens.

---

## Compatibility Findings

### Gemma 4 27B on vLLM — fp8 KV not supported on Ampere
Gemma 4 forces `TRITON_ATTN` backend due to heterogeneous head dims (local 256, global 512).
The Triton attention kernel uses `fp8e4nv` (NVIDIA fp8 e4m3) which Ampere does not support
(RTX 3090 only has `fp8e4b15`/`fp8e5`). **Fix: `--kv-cache-dtype auto` (BF16 KV).**

### Gemma 4 27B on SGLang — Marlin MoE incompatibility
`RuntimeError: size_n = 4304 is not divisible by tile_n_size = 64` in `gptq_marlin_repack.cuh`.
Gemma 4's MoE expert output dimension (4304) does not align to Marlin's 64-wide tile requirement.
This is a SGLang Marlin kernel bug with Gemma 4's architecture — affects all tested images
(`lmsysorg/sglang:gemma4`). Needs upstream fix in the Marlin kernel.

### Qwen3.6-35B AWQ on SGLang — weight key mismatch
`KeyError: model.layers.0.mlp.experts.w2_weight` in SGLang's `qwen3_5.py` weight loader.
SGLang maps Qwen3.6 to the Qwen3.5 MoE loader which expects fused `w2_weight` keys, but
`QuantTrio/Qwen3.6-35B-A3B-AWQ` stores weights in the standard unfused format. Affects both
`v0.5.10.post1` and `latest`. Needs a native Qwen3.6 model class in SGLang.
**Workaround: use vLLM** (compressed-tensors handles this correctly).

### Qwen3.6-35B AWQ on vLLM — Mamba block size fix required
Default `--max-num-batched-tokens=2048` fails because Qwen3.6 uses a hybrid Mamba+attention
architecture with Mamba block_size=2096. **Fix: `--max-num-batched-tokens 4096`.**

### gpt-oss-20b on vLLM — reasoning model mechanics
gpt-oss-20b streams thinking tokens as `delta.reasoning` before emitting `delta.content`.
The thinking chain consumes all tokens if `max_tokens` is too low — 2000 is required for the
benchmark prompt (yields ~1,307 thinking + ~684 content tokens). Concurrency at 4 causes 2/4
workers to exhaust the token budget on thinking alone.
**MXFP4 works on Ampere** via Marlin backend (`vllm/vllm-openai:latest`), no special flags needed.

---

## Gemma 4 27B AWQ — vLLM (BF16 KV, Ampere)

### Sequential
| Metric | Value |
|--------|-------|
| Runs | 3 |
| Avg TTFT (to first content) | 1012 ms |
| Avg fill rate (prefill) | 5,436 tok/s |
| Avg decode throughput | 115.8 tok/s |
| Avg TTS | 3.63 s |
| Prompt tokens | 303 |
| Output tokens | 300 |

| Run | TTFT (ms) | Fill (ptok/s) | Decode (tok/s) | TTS (s) |
|-----|-----------|---------------|----------------|---------|
| 1 | 2960 | 102 | 100.4 | 5.95 |
| 2 | 38 | 7984 | 123.6 | 2.47 |
| 3 | 37 | 8222 | 123.4 | 2.47 |

Run 1 is first-request warmup + torch.compile JIT; runs 2-3 reflect steady-state.

### Concurrency=4
| Metric | Value |
|--------|-------|
| Requests | 4/4 succeeded |
| P50 TTFT | 1,368 ms |
| P95 TTFT | 1,368 ms |
| Min TTFT | 44 ms |
| Max TTFT | 1,368 ms |
| Aggregate throughput | 229.4 tok/s |
| Wall time | 5.2 s |

### Cache Performance
| Condition | Avg TTFT | vs cold |
|-----------|----------|---------|
| Cache cold | 54 ms | 1.0× |
| Cache warm | 36 ms | 1.5× faster |

### Context Length Probe
| Context (tokens) | Result |
|-----------------|--------|
| 4,096 | ✓ OK — TTFT=1,195ms, decode=117.3 tok/s |
| 8,192 | ✓ OK — TTFT=1,321ms, decode=111.9 tok/s |
| 16,384 | ✓ OK — TTFT=2,961ms, decode=97.0 tok/s |
| 32,768 | ✗ FAILED (exceeds max_model_len=32768) |

**Max confirmed context: 16,384 tokens** (deployable up to 32,468 with max_model_len=32768 and 300-token budget).  
BF16 KV uses more VRAM than fp8 — could raise max_model_len to ~24k before running out of KV headroom.  
With fp8 KV support (requires H100+), context ceiling would extend to ~64k+.

---

## Qwen3.6-35B AWQ — vLLM (fp8 KV)

### Sequential
| Metric | Value |
|--------|-------|
| Runs | 3 |
| Avg TTFT (to first content) | 6,454 ms |
| Avg fill rate (prefill) | 2,410 tok/s |
| Avg decode throughput | 143.0 tok/s |
| Avg TTS | 8.58 s |
| Prompt tokens | 301 |
| Output tokens | 300 |

| Run | TTFT (ms) | Fill (ptok/s) | Decode (tok/s) | TTS (s) |
|-----|-----------|---------------|----------------|---------|
| 1 | 19,195 | 16 | 120.2 | 21.69 |
| 2 | 83 | 3,608 | 154.4 | 2.03 |
| 3 | 84 | 3,606 | 154.4 | 2.03 |

Run 1 is first-request warmup (torch.compile, ~19s); runs 2-3 are steady-state.

### Concurrency=4
| Metric | Value |
|--------|-------|
| Requests | 4/4 succeeded |
| P50 TTFT | 450 ms |
| P95 TTFT | 450 ms |
| Min TTFT | 89 ms |
| Max TTFT | 450 ms |
| Aggregate throughput | 415.6 tok/s |
| Wall time | 2.9 s |

**Highest aggregate throughput of all tested models at 4× concurrency.**

### Cache Performance
| Condition | Avg TTFT | vs cold |
|-----------|----------|---------|
| Cache cold | 273 ms | 1.0× |
| Cache warm | 84 ms | 3.3× faster |

**Strongest prefix cache benefit** (3.3×) — Qwen3.6's larger model benefits more from cache hits.

### Context Length Probe
| Context (tokens) | Result |
|-----------------|--------|
| 4,096 | ✓ OK — TTFT=2,126ms, decode=153.7 tok/s |
| 8,192 | ✓ OK — TTFT=1,660ms, decode=151.6 tok/s |
| 16,384 | ✓ OK — TTFT=1,964ms, decode=149.1 tok/s |
| 32,768 | ✓ OK — TTFT=4,644ms, decode=145.9 tok/s |
| 65,536 | ✗ FAILED (exceeds max_model_len=65536) |

**Max confirmed context: 32,768 tokens** with max_model_len=65536. True ceiling is ~65,236 tokens (65536 minus output budget).  
Decode throughput is remarkably stable across context lengths (153→146 tok/s at 32k) — fp8 KV is doing its job.

---

## gpt-oss-20b MXFP4 — vLLM (BF16 KV)

> Reasoning model: each request emits ~1,307 thinking tokens before content. TTFT here is  
> time to first *content* token (6.2s thinking phase included in TTS, not TTFT definition).

### Sequential
| Metric | Value |
|--------|-------|
| Runs | 3 |
| Avg TTFT (to first content) | 6,220 ms |
| Avg fill rate (prefill) | 56 tok/s |
| Avg thinking time | 6.2 s |
| Avg thinking tokens | 1,307 |
| Avg decode throughput | 209.5 tok/s |
| Avg TTS | 9.48 s |
| Prompt tokens | 347 |
| Output tokens | 684 |

| Run | TTFT (ms) | Fill (ptok/s) | Decode (tok/s) | TTS (s) |
|-----|-----------|---------------|----------------|---------|
| 1 | 6,233 | 56 | 209.8 | 9.49 |
| 2 | 6,214 | 56 | 209.4 | 9.48 |
| 3 | 6,214 | 56 | 209.4 | 9.48 |

**Fastest decode throughput** of all tested models (209.5 tok/s single user) — MXFP4 Marlin on
Ampere is highly effective for the dense attention layers. Active params ~3.6B make decode cheap.

### Concurrency=4
| Metric | Value |
|--------|-------|
| Requests | 2/4 succeeded |
| P50 TTFT | 9,818 ms |
| Min TTFT | 8,353 ms |
| Aggregate throughput | 100.0 tok/s |
| Wall time | 14.3 s |

At concurrency=4 the 2000-token budget is exhausted by thinking tokens for 2/4 workers.
For production use: set `max_tokens` to 4000+ or add `"Reasoning: low"` system message.

### Cache Performance
| Condition | Avg TTFT | vs cold |
|-----------|----------|---------|
| Cache cold | 7,290 ms | 1.0× |
| Cache warm | 5,918 ms | 1.2× faster |

Cache benefit is minimal (1.2×) — the bottleneck is thinking time, not prefill.

### Context Length Probe
| Context (tokens) | Result |
|-----------------|--------|
| 4,096 | ✓ OK — TTFT=604ms, decode=202.0 tok/s |
| 8,192 | ✓ OK — TTFT=620ms, decode=191.3 tok/s |
| 16,384 | ✓ OK — TTFT=644ms, decode=173.5 tok/s |
| 32,768 | ✗ FAILED (exceeds max_model_len=32768) |

**Max confirmed context: 16,384 tokens.** Context probe uses a simple summary prompt (no reasoning chain triggered), so TTFT here reflects pure prefill speed — fast at 600-644ms.

---

## Cross-Model Decode Throughput Comparison

| Model | Single-user decode | 4× concurrency agg. | Notes |
|-------|-------------------|---------------------|-------|
| Gemma 4 27B | 123.5 tok/s | 229.4 tok/s | BF16 KV; fp8 blocked on Ampere |
| Qwen3.6-35B | 154.4 tok/s | 415.6 tok/s | fp8 KV; hybrid Mamba boosts throughput |
| gpt-oss-20b | 209.5 tok/s | 100.0 tok/s† | MXFP4 + tiny active params; reasoning degrades concurr. |

† gpt-oss-20b concurrency degrades because thinking chains consume token budget.

## Recommendations

1. **Production workloads (multi-user, tool use)**: Qwen3.6-35B on vLLM. Best throughput at
   concurrency, strong prefix cache benefit (3.3×), fp8 KV works, 32k+ context.

2. **Reasoning/coding tasks**: gpt-oss-20b on vLLM. Fastest single-user decode (209 tok/s),
   near-o4-mini quality per benchmarks. Set `max_tokens ≥ 4000` and budget for thinking time.

3. **Gemma 4**: Only viable on vLLM with BF16 KV (fp8 blocked on Ampere). Good single-user
   performance but SGLang blocked by Marlin bug — skip for now.

4. **SGLang for these models**: Not viable until upstream fixes:
   - Marlin tile size patch for Gemma 4 (4304-dim experts)
   - Native Qwen3.6 model class (weight key mismatch)

5. **Context length**: To push past 16k on Gemma 4 or 32k on Qwen3.6/gpt-oss-20b, increase
   `max_model_len` and re-run context probe. fp8 KV is critical for Qwen3.6 at long contexts.
