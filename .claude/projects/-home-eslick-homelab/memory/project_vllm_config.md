---
name: vLLM config & model history
description: vLLM/SGLang runtime config, current default model, Gemma4 KV constraints, and how to switch models
type: project
---

Current default: `cyankiwi/gemma-4-26B-A3B-it-AWQ-4bit` served as `gemma4-27b-a3b` on vLLM gemma4 image, port 8081.

**Why:** A3B has ~3B active params vs A4B's ~4B — same VRAM footprint, ~10-15% faster decode. Switched from A4B as of 2026-04-24.

**Ampere constraint:** Gemma 4 requires `--kv-cache-dtype auto` (BF16 KV). fp8e4nv unsupported on RTX 3090 — Triton attn kernel requires H100+. This applies to both A3B and A4B variants.

**SGLang blocked for Gemma 4:** Marlin tile size 4304 not divisible by 64 — upstream fix needed.

**To revert to A4B:**
```
ansible-playbook playbooks/vllm.yml --tags docker \
  -e vllm_model_id=cyankiwi/gemma-4-26B-A4B-it-AWQ-4bit \
  -e vllm_served_model_name=gemma4-27b
```

**To switch to Qwen3.6-35B (best throughput):**
```
ansible-playbook playbooks/vllm.yml --tags docker \
  -e vllm_model_id=QuantTrio/Qwen3.6-35B-A3B-AWQ \
  -e vllm_served_model_name=qwen3.6-35b-a3b \
  -e vllm_max_model_len=65536 \
  -e "vllm_extra_args=--max-num-batched-tokens 4096"
```

**How to apply:** See `playbooks/vllm.yml` model options block. Full perf summary in `docs/inference-config-summary.md`.
