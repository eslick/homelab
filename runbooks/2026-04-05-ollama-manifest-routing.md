# Ollama + Manifest Routing Setup

## Task
Configure Ollama for single-3090 stability, pull local inference models, and wire
Manifest tier routing inside the OpenClaw container to use local Ollama models for
lower tiers and OpenAI o3 for reasoning.

## Playbook Used
`playbooks/ollama.yml`

```bash
# Full apply (service + models + manifest routing)
ansible-playbook playbooks/ollama.yml

# Service config only (no model downloads)
ansible-playbook playbooks/ollama.yml --tags configure,service,security

# Model downloads only
ansible-playbook playbooks/ollama.yml --tags models

# Manifest routing only
ansible-playbook playbooks/ollama.yml --tags manifest
```

## Ollama Service Settings (single-3090 conservative)
| Variable | Value | Reason |
|---|---|---|
| OLLAMA_MAX_LOADED_MODELS | 1 | Prevent VRAM thrash between models |
| OLLAMA_NUM_PARALLEL | 2 | Allow 2 concurrent requests per model |
| OLLAMA_MAX_QUEUE | 32 | Backpressure limit |
| OLLAMA_KEEP_ALIVE | 15m | Unload idle models after 15 min |
| OLLAMA_FLASH_ATTENTION | 1 | Enable flash attention for speed |
| OLLAMA_GPU_OVERHEAD | 2147483648 | Reserve 2 GB GPU for system |

## Manifest Tier Routing
| Tier | Model | Provider |
|---|---|---|
| simple | qwen3.5:8b | ollama (local) |
| standard | gemma4:26b-a4b-it-q4_K_M | ollama (local) |
| complex | qwen3.5:27b | ollama (local) |
| reasoning | o3 | openai |

Manifest's local API is called from **inside** the container (loopback only — no
external auth needed). The custom provider uses `http://host.docker.internal:11434/v1`.

## Verification Steps

```bash
# Ollama service health
systemctl status ollama --no-pager
curl -s http://localhost:11434/api/tags | python3 -m json.tool

# Verify models are loaded
ollama list

# Verify Manifest tier routing (from inside container)
docker exec openclaw-gateway curl -sf \
  http://127.0.0.1:2099/api/v1/routing/open-claw/tiers | python3 -m json.tool

# Verify custom providers
docker exec openclaw-gateway curl -sf \
  http://127.0.0.1:2099/api/v1/routing/open-claw/custom-providers | python3 -m json.tool

# Test a model directly
ollama run qwen3.5:8b "say hello"
```

## Rollback

### Revert Manifest tier routing to unset
```bash
for tier in simple standard complex reasoning; do
  docker exec openclaw-gateway curl -sf -X DELETE \
    http://127.0.0.1:2099/api/v1/routing/open-claw/tiers/$tier
done
```

### Revert Ollama service override to minimal config
```bash
cat > /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
systemctl daemon-reload && systemctl restart ollama
```

## Troubleshooting

**VRAM thrash / swap instability**
- Lower `OLLAMA_NUM_PARALLEL` to 1 in override.conf
- Reduce context in Manifest tier config

**Slow model swaps between Gemma and Qwen**
- Normal on a single 3090 with `MAX_LOADED_MODELS=1`
- Keep Gemma 4 as the default; Qwen 27B only for clearly complex tasks

**Queue backups**
- Increase `OLLAMA_MAX_QUEUE` from 32 to 64
- Keep heartbeat output tokens very small
