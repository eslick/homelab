# 2026-10-13 — Dense Qwen3.6-27B on vLLM + multi-model LLM gateway

## Task
Serve the Qwen3.6 dense model alongside the MoE on the dual 3090s, one at a time. The gateway must answer
**503 + Retry-After** for a model while the other one is mid-request, so agents can wait-loop, and swap
containers once the first is idle. Dense had been unusable: `QuantTrio/Qwen3.6-27B-AWQ` on SGLang produced
`!` spam (docs/benchmark-2026-04-29-nvlink-dense.md).

## What changed
- **vLLM runs the dense model** (`playbooks/vllm.yml`, promoted from `optional/`): `vllm/vllm-openai:v0.29.0`,
  container `vllm-dense`, same checkpoint, `--reasoning-parser qwen3 --tool-call-parser qwen3_coder`,
  `--max-model-len 131072 --max-num-seqs 4 --gpu-memory-utilization 0.88`, KV cache bf16 (`auto`).
  The `!` bug does not reproduce on vLLM, so it is an SGLang-side problem; SGLang keeps the MoE.
- **`projects/sglang-watcher` → `projects/llm-gateway`** (`playbooks/llm-gateway.yml`, new subsystem, imported in
  `site.yml`). Routes by the request's `model` field (unknown/missing -> `qwen3.6-35b-a3b`), at most one
  inference container running. Busy = requests in flight (streams included), still loading, or a 90 s claim after
  a client timed out waiting on a load. 503 body is OpenAI-style (`server_is_overloaded`, with `reason`:
  `busy` | `loading` | `failed` | `upstream`) plus `Retry-After`. A request blocks up to 90 s on a load, then gets
  503 `loading`. Idle containers stop after 300 s. `/v1/models`, `/health`, `/gateway/status` (alias
  `/watcher/status`) are answered locally and never start a GPU container.
- Container is `llm-gateway` but keeps the network alias `sglang-watcher` (Arcana's `homelab` profile uses
  `sglang-watcher:8080`). Host port unchanged (127.0.0.1:8081, nginx :8082 unchanged).
- `sglang.yml` now only creates the `sglang` container (watcher + UFW + "stop vLLM" tasks removed);
  both runtime containers are created-not-started, `restart: "no"`, and shared `vllm-models` HF cache.
- Retired: `sglang-watcher` container/image (`state: absent` in llm-gateway.yml).
- README, Makefile (`sglang-status`), overview pages updated.

## Playbook Used
`playbooks/vllm.yml`, `playbooks/sglang.yml`, `playbooks/llm-gateway.yml` (all tags), `playbooks/nginx.yml --tags overview`.
Order matters on a rebuild: sglang.yml, vllm.yml, then llm-gateway.yml (`site.yml` has it).

## Verification Steps
- Dense on vLLM: correct answer, reasoning split from content, tool call returned as structured JSON,
  ~69 tok/s single stream, needle found in a 67k-token prompt (40 s prefill). KV cache 282k tokens
  (2.2x concurrency at 131072).
- Gateway unit scenarios (fake Docker, mock backends): 503 while a stream is open without evicting, swap after the
  stream ends, loading claim blocks eviction, unknown model -> default.
- Live end-to-end (`curl`-equivalent client): dense cold start (503 loading at 90 s, 200 at 130 s); MoE request during
  a dense stream -> `503 busy, Retry-After: 30`; after the stream, MoE retried until 200 and `sglang` was the only
  inference container running.
- `curl -s localhost:8081/gateway/status`; `docker ps | grep -E 'sglang|vllm-dense|llm-gateway'`.

## Notes
- First start of a freshly *recreated* container is slow (SGLang MoE took ~6 min, normally ~80 s) because the
  container's JIT/compile caches are lost on recreate. Don't re-run the playbooks needlessly.
- Gateway only counts requests that pass through it; a container started by hand is treated as idle and
  will be stopped when another model is requested.
- Not tried: fp8 KV cache on dense (would roughly double context capacity), MTP speculative decoding
  (vLLM issue #46249: broken tool calls with MTP on some builds), prefix caching with the hybrid model is
  enabled but unverified for hit rate.

## Rollback
`git revert` this commit, then `ansible-playbook playbooks/sglang.yml` and bring back the old watcher from git
history (`projects/sglang-watcher`, the `sglang-watcher` service in `templates/sglang-compose.yml.j2`).
To only take dense out: remove its entry from `llm_models` in `playbooks/llm-gateway.yml`, re-run with `--tags configure,docker,gateway`.
