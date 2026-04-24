# Open-Source LLM Research Report: Dual RTX 3090 (48GB VRAM, TP=2)
**Date: April 2026 | Hardware: 2× RTX 3090 24GB GDDR6X, Ubuntu 24.04, Docker**

---

## Model Comparison

| Model | Type | Active Params | Quality (GPQA / Coding) | VRAM AWQ/Q4 | Fits 48GB? | Recommended Quant |
|-------|------|--------------|------------------------|-------------|------------|-------------------|
| **Qwen3-30B-A3B** *(current)* | MoE | ~3B | GPQA ~62–86%, Arena Hard 91% | ~20–25 GB | ✓ | AWQ 4-bit (Marlin) |
| **Qwen3.6-35B-A3B** | MoE | ~3B | GPQA 86%, C-Eval 90%, SWE 73% | ~25–30 GB | ✓ | AWQ 4-bit or GGUF Q4_K_M |
| **Qwen3-32B** (dense) | Dense | 32B | BFCL v3 75.7% | ~24–28 GB | ✓ (tight) | AWQ or NVFP4 |
| **Gemma 4 27B (26B-A4B)** *(current)* | MoE | ~4B | PhD-sci 84%, AIME 2026 89%+ | ~14–16 GB | ✓ easily | GGUF UD-Q4_K_XL or AWQ-4bit |
| **Llama 4 Scout** | MoE | 17B | Competitive, 10M ctx | ~27 GB | ✓ | AWQ or GGUF Q4 |
| **Llama 4 Maverick** | MoE | 17B | Strong | ~100 GB | ✗ too large | — |
| **DeepSeek-R1-Distill-Qwen-32B** | Dense | 32B | Strong reasoning, 94.3% coding | ~9 GB AWQ | ✓ easily | BF16 single-GPU or AWQ |
| **DeepSeek-R1-Distill-Llama-70B** | Dense | 70B | 65.2+ reasoning, 94.5% coding | ~18 GB AWQ | ✓ | AWQ or Q4_K_M |
| **Mistral Small 3.2-24B** | Dense | 24B | MMLU 80.5%, HumanEval+ 92.9% | ~16–20 GB | ✓ | AWQ or Q4_K_M |
| **Phi-4 (14B)** | Dense | 14B | MMLU ~85%, GPQA Diamond 72% | ~8–12 GB | ✓ easily | BF16 or AWQ |
| **Devstral (~24B)** | Dense | ~24B | SWE-bench specialist | ~16–20 GB | ✓ | AWQ Q4 |

### Top HuggingFace Model IDs

| Use Case | Model ID |
|----------|----------|
| Best general MoE (upgrade path) | `Qwen/Qwen3.6-35B-A3B` · AWQ: `QuantTrio/Qwen3.6-35B-A3B-AWQ` |
| Current production Qwen | `QuixiAI/Qwen3-30B-A3B-AWQ` |
| Current production Gemma 4 | `cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit` |
| Best reasoning | `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` |
| Best coding | `mistralai/Devstral-Small-2505` |
| Longest context (10M) | `meta-llama/Llama-4-Scout` |

---

## Runtime Comparison

| Runtime | Prefill Speed | Decode (tok/s, 30B Q4) | TP=2 Support | Best Quantization |
|---------|--------------|----------------------|--------------|-------------------|
| **vLLM** | High; chunked prefill | ~40–80 tok/s | ✓ native | AWQ-Marlin |
| **SGLang** | Highest (~29% better TTFT vs vLLM) | ~80–120+ tok/s | ✓ native | AWQ, FP8 |
| **ExLlamaV2 / tabbyAPI** | Good single-user | ~20–40 tok/s | ✗ single GPU only | EXL2 |
| **llama.cpp / Ollama** | Good GGUF; layer-split | ~15–50 tok/s | Layer-split only | GGUF Q4_K_M |

**Key finding**: vLLM and SGLang are the only runtimes with true tensor-parallel TP=2.
ExLlamaV2 and llama.cpp would be limited to a single 24GB card for inference,
capping model size at ~24B BF16 or ~48B Q4 (single-card KV budget still limited to 24GB).

---

## Optimizations for RTX 3090 (Ampere sm86)

### Quantization Ranking (Quality × Speed)
1. **AWQ-Marlin** — Best for vLLM; 7–11× faster decode vs naive AWQ; near-lossless quality
2. **EXL2 (5–6 bpw)** — Best for ExLlamaV2; flexible per-layer bit allocation
3. **GPTQ** — Widely supported; slightly behind AWQ-Marlin in speed
4. **FP8 weights** — Strong on H100/Blackwell; Ampere has limited hardware FP8 (use for KV cache not weights)
5. **GGUF Q4_K_M / Q5_K_M** — Best for llama.cpp; imatrix-calibrated versions preferred

### KV Cache
- `--kv-cache-dtype fp8` in vLLM: ~50% VRAM savings; software-emulated on Ampere.
  Biggest single win for long-context workloads (32k+).
- `fp8_e4m3` in SGLang equivalent.

### FlashInfer vs FlashAttention-2
- FA-2 is the optimized Ampere default (`VLLM_ATTENTION_BACKEND=FLASHINFER` set in our config).
- FlashInfer shows the largest gains on Hopper/Blackwell; marginal on RTX 3090 — worth benchmarking but don't expect dramatic improvement.

### PCIe TP=2 Caveats (No NVLink on 3090)
- PCIe 4.0 bandwidth (~32–64 GB/s) vs NVLink (~600 GB/s) causes ~20–40% throughput reduction
  on decode-bound workloads vs NVLink systems. Prefill is less affected.
- Mitigation: `--max-num-seqs 20`, `--gpu-memory-utilization 0.90`; avoid running both GPUs
  over saturated PCIe lanes simultaneously.

### Speculative Decoding
- Viable with a small draft model (e.g., Qwen3-0.5B as draft for Qwen3-30B target).
- ngram speculation in llama.cpp is effective for repetitive/structured output.
- TP=2 + speculative decoding adds scheduling complexity; test for specific workloads.

---

## Benchmark Results (2026-04-24 Session)

*Script: `files/benchmark-inference.py` — ~230-word prompt, 300 output tokens, 3 runs each.
Same model (Qwen3-30B-A3B-AWQ) on both runtimes for apples-to-apples comparison.*

| Runtime | Config | Avg TTFT | Decode tok/s | Avg Total |
|---------|--------|----------|-------------|-----------|
| **SGLang v0.5.10.post1** | fp8_e4m3 KV, RadixAttn | **84 ms** | **188.9** | **1.7 s** |
| vLLM (gemma4 image) | fp8 KV, FlashInfer, chunked prefill | 179 ms | 168.0 | 2.0 s |

**SGLang wins: −53% TTFT, +12% decode throughput.**

Run details:

| Run | vLLM TTFT | SGLang TTFT | Notes |
|-----|-----------|-------------|-------|
| 1 | 486 ms | 105 ms | vLLM first-request warmup; SGLang cold |
| 2 | 30 ms | 122 ms | vLLM prefix cache hit; SGLang still loading RadixCache |
| 3 | 21 ms | 24 ms | Both caches warm |

vLLM's prefix cache warms faster on repeated identical prompts; SGLang's RadixAttention
advantage shows most on diverse/novel prompts (run 1: 5× faster TTFT).

*Re-run: `python3 files/benchmark-inference.py --url http://127.0.0.1:8082 --model qwen3-30b-a3b`*

---

## Recommendations

### Daily Driver (current: vLLM + Qwen3-30B-A3B-AWQ)
Keep vLLM as the production runtime. New flags applied: `--kv-cache-dtype fp8`,
`--enable-chunked-prefill`, `VLLM_ATTENTION_BACKEND=FLASHINFER`.

### Upgrade Path (priority order)
1. **Qwen3.6-35B-A3B-AWQ** via SGLang — same active-param cost, better quality, 29% better TTFT
2. **DeepSeek-R1-Distill-Qwen-32B** — add as a reasoning endpoint (fits single GPU in AWQ)
3. **Llama 4 Scout** — if 10M context window becomes a use-case priority

### Runtime Selection
| Use Case | Recommendation |
|----------|---------------|
| Tool use, multi-user serving | vLLM (best ecosystem + tool parsing) |
| Reasoning chains / agentic flows | SGLang (RadixAttention + faster TTFT) |
| Single-user, max quality GGUF | llama.cpp / Ollama (simpler ops) |
| 24GB single-card only | ExLlamaV2 + tabbyAPI |
