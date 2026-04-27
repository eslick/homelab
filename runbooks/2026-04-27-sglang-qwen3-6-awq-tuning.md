## Task
Deploy and stabilize SGLang inference server with `QuantTrio/Qwen3.6-35B-A3B-AWQ` on 2× RTX 3090 (TP=2). Fix Triton `causal_conv1d` compilation crash, extend context to 128K tokens, and validate performance for personal agent workloads.

## Playbook Used
`playbooks/sglang.yml` — tags: `docker`, `sglang`, `configure`

## Root Cause of Triton Crash
AWQ models store `conv_states` in bf16, but input tensors `x` arrive as fp16 from the AWQ quantized forward pass. The Triton kernel's `if load_init_state` branch loads bf16 from conv_states, while the `else` branch initializes zeros using `x_ptr.dtype.element_ty` (fp16). Triton's type checker rejects the mismatch at compile time:

```
AssertionError: Mismatched type for col0 between
  then block (<['256'], bf16>)
  else block (<['256'], fp16>)
```

## Fix Applied
Patched `/opt/sglang-patches/causal_conv1d_triton.py` — cast all `tl.load()` calls in the `if load_init_state:` branch to `_x_dtype = x_ptr.dtype.element_ty`. This aligns bf16 conv_states with the fp16 input type at the Triton IR level.

The patch file is bind-mounted read-only into the container via `sglang_awq_patch: true` in `playbooks/sglang.yml`:
```
/opt/sglang-patches/causal_conv1d_triton.py → /sgl-workspace/sglang/.../causal_conv1d_triton.py:ro
```

A second patch (`awq.py`) adds bf16→x.dtype cast in `causal_conv1d.py` to handle `conv_states` dtype mismatch in the sgl_kernel path.

## Configuration
Key vars in `playbooks/sglang.yml`:
- `sglang_image: sglang-base:working` — pinned local image (sha256:40c1b9d45304), avoids CUDA 13.0 breakage in latest upstream
- `sglang_max_model_len: 131072` — YaRN factor=4.0 extends base 32768 to 131072
- `sglang_gpu_memory_fraction: 0.88` — yields ~503K KV token pool across both cards
- `sglang_extra_args` includes `--chunked-prefill-size 8192 --max-running-requests 4 --attention-backend flashinfer --mamba-scheduler-strategy no_buffer --reasoning-parser qwen3 --tool-call-parser qwen`
- `sglang_json_model_override_args`: YaRN rope scaling `{"rope_scaling":{"rope_type":"yarn","factor":4.0,"original_max_position_embeddings":32768}}`

## Performance Baseline (2× RTX 3090, TP=2)
| Metric | Value |
|---|---|
| Decode throughput | ~123 tok/s |
| Cold TTFT (96K tokens) | ~24s (~4K tok/s prefill) |
| Warm TTFT (96K tokens, radix cache hit) | ~8s (3.1× speedup) |
| Max context | 131072 tokens |
| KV pool | ~503K tokens |
| CUDA graph startup | ~4-5 min |

## Things That Did NOT Work
- `--attention-backend fla` — not a valid backend (was hallucinated advice)
- `--mamba-backend torch` — only `triton` or `flashinfer` accepted
- `--enable-hierarchical-cache` — crashed with `RuntimeError: Destination indices must be a CUDA tensor`
- `--disable-cuda-graph` — causes 20× decode regression (140→7 tok/s); CUDA graphs are required
- Installing `causal-conv1d` PyPI package — SGLang uses `sgl_kernel` internally, not the PyPI package; also no precompiled wheels for cu129+torch2.9+py3.12
- Rebuilding with `files/sglang/Dockerfile` — upstream image updated to cu130 while running container has cu129, breaking pip wheel installs
- `Qwen/Qwen3.6-35B-A3B-AWQ` — does not exist on HuggingFace; use `QuantTrio/Qwen3.6-35B-A3B-AWQ`

## Verification Steps
```bash
# Check container health
docker ps --filter name=sglang --format '{{.Status}}'

# Quick inference test
curl -s http://127.0.0.1:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6-35b-a3b","messages":[{"role":"user","content":"Reply with only: OK"}],"max_tokens":10}' | jq .

# Check VRAM usage
nvidia-smi --query-gpu=memory.used,memory.total --format=csv
```

## Rollback
```bash
# Stop SGLang
docker compose -f /opt/compose/sglang/docker-compose.yml down

# Return to vLLM
ansible-playbook playbooks/vllm.yml --tags docker
```

## Notes
- Container startup takes ~10 min (CUDA graph capture + model load)
- `no_buffer` Mamba scheduler disables stateful cache branching — required for stability with this model
- YaRN context extension is fully validated up to 96K tokens (5/5 long-context retrieval accuracy)
