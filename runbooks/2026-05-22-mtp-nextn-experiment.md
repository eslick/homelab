# MTP/NEXTN Speculative Decoding Experiment — Qwen3.6-35B-A3B-AWQ

## Task

Evaluate whether enabling Multi-Token Prediction (MTP/NEXTN speculative decoding)
on the Qwen3.6-35B-A3B-AWQ MoE model produced a decode throughput improvement.

## Baseline (no MTP)

**Config**: `vars/sglang-qwen3-moe.yml` at commit prior to this experiment  
**Key flags**: `--mamba-scheduler-strategy no_buffer`, `--mem-fraction-static 0.88`, no speculative args

| Scenario | TTFT (avg) | Decode (tok/s) | Aggregate (tok/s) |
|----------|-----------|----------------|-------------------|
| 4K ctx — sequential (3 runs) | 20,661 ms | 162.0 | — |
| 4K ctx — concurrent (4 threads) | 25,344 ms | 136.1 / chain | 132.5 |
| 16K ctx — sequential (3 runs) | 19,408 ms | 151.1 | — |
| 16K ctx — concurrent (4 threads) | 28,414 ms | 119.6 / chain | 132.8 |

## MTP Attempt

**Flags added**: `--speculative-algo NEXTN --speculative-num-steps 3 --speculative-eagle-topk 1 --speculative-num-draft-tokens 4`

### Obstacles encountered (in order)

1. **`no_buffer` incompatible with speculative decoding** — SGLang raised `ValueError`:
   > Speculative decoding for Qwen3_5MoeForConditionalGeneration is not compatible with radix cache when using `--mamba-scheduler-strategy no_buffer`. Use `extra_buffer` and set `SGLANG_ENABLE_SPEC_V2=1`.

2. **NVML driver/library version mismatch** — An unrelated `apt upgrade` during the session updated NVIDIA packages from 595.58 → 595.71 while the old kernel module remained loaded. Resolved by building the DKMS module manually and reloading it without a reboot.

3. **CUDA OOM at 0.88 mem fraction** — `extra_buffer` allocates intermediate Mamba state caches (~1.07 GB/GPU), leaving only 182 MB free — 38 MB short of what the draft worker needed. Resolved by reducing `--mem-fraction-static` from 0.88 → 0.85.

4. **BFloat16/Half dtype mismatch** — During CUDA graph warmup, the draft worker used fp16 while the main model used bf16. Resolved by adding `--dtype bfloat16`.

### MTP results (4K ctx only — 16K failed entirely)

| Scenario | TTFT (avg) | Decode (tok/s) | Aggregate (tok/s) |
|----------|-----------|----------------|-------------------|
| 4K ctx — sequential (3 runs) | 14,101 ms | **76.5** | — |
| 4K ctx — concurrent (4 threads) | 20,691 ms | **58.6 / chain** | **64.1** |
| 16K ctx | — | **all failed** | — |

### Why it failed

- **Decode regression**: ~76 tok/s vs 162 tok/s baseline (53% slower). Overhead from SpecV2 + `extra_buffer` Mamba management exceeds any draft-acceptance speedup.
- **16K context broke entirely**: Forcing `--dtype bfloat16` changes model generation behavior — the model burns all 8192 max_tokens in reasoning mode and never produces content tokens. This is a hard regression.
- **Root cause**: This AWQ model + hybrid Mamba/MoE architecture + SpecV2 requirement is not a viable combination with the current SGLang `sglang-base:working` image. The `extra_buffer` scheduler (required for speculative decoding) is significantly more expensive than `no_buffer`, and forcing bf16 breaks generation quality.

## Verdict: Reverted to baseline

MTP was reverted. The original `no_buffer` + 0.88 mem fraction config is restored.

## Conditions that might make MTP viable in the future

- A newer SGLang image that supports `no_buffer` + NEXTN without requiring SpecV2
- An FP8 or BF16 quantized variant (not AWQ) of the model, which avoids the dtype forcing issue
- A non-Mamba model (pure transformer) where no scheduler strategy constraint exists

## Playbook Used

`playbooks/sglang.yml` with `vars/sglang-qwen3-moe.yml`

## Verification Steps

```bash
curl -s http://127.0.0.1:8081/watcher/status
# Confirm sglang_running: true after first request

python3 files/benchmark-nvlink.py \
  --model qwen3.6-35b-a3b --context-sizes 4096,16384 --runs 3 --concurrency 4
```

## Rollback

Revert `vars/sglang-qwen3-moe.yml` to:
- `sglang_gpu_memory_fraction: "0.88"`
- `--mamba-scheduler-strategy no_buffer`
- Remove `--dtype bfloat16`, `--speculative-algo NEXTN` and related flags
- Remove `sglang_spec_v2: true`

Then redeploy: `ansible-playbook playbooks/sglang.yml -e @vars/sglang-qwen3-moe.yml`
