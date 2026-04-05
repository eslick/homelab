# Ollama + Manifest Routing Setup

## Task
Configure Ollama for single-3090 stability, pull local inference models, wire
Manifest tier routing inside the OpenClaw container to use local Ollama models for
lower tiers, Together AI for cloud frontier models, and OpenAI o4-mini for reasoning.

## Playbook Used
`playbooks/ollama.yml` — Ollama service, model pulls, Manifest routing
`playbooks/docker.yml` — OpenClaw compose (TOGETHER_API_KEY env var)

```bash
# Full apply (service + models + manifest routing)
ansible-playbook playbooks/ollama.yml

# Service config only (no model downloads)
ansible-playbook playbooks/ollama.yml --tags configure,service,security

# Model downloads only
ansible-playbook playbooks/ollama.yml --tags models

# Manifest routing only
ansible-playbook playbooks/ollama.yml --tags manifest

# Redeploy OpenClaw with updated env vars
ansible-playbook playbooks/docker.yml --tags docker,configure
ansible-playbook playbooks/docker.yml --tags openclaw,service
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

## Manifest Providers
| Provider | Type | Base URL |
|---|---|---|
| ollama | custom OpenAI-compat | http://host.docker.internal:11434/v1 |
| together | custom OpenAI-compat | https://api.together.xyz/v1 |
| openai | native | (uses OPENAI_API_KEY from container env) |

## Manifest Tier Routing
| Tier | Model | Provider |
|---|---|---|
| small | gemma4:26b-a4b-it-q4_K_M | ollama (local) |
| standard | gemma4:26b-a4b-it-q4_K_M | ollama (local) |
| local-advanced | qwen3.5:27b | ollama (local) |
| advanced | Qwen/Qwen3.5-397B-A17B | together |
| long-context | nvidia/Nemotron-3-Nano | together |
| thinking | o4-mini | openai |

Manifest's local API is called from **inside** the container (loopback only — no
external auth needed). Custom providers use `http://host.docker.internal:11434/v1`
for Ollama and `https://api.together.xyz/v1` for Together.

The Together API key is stored in the Ansible vault as `together_ai_api_key` and
injected into the container as `TOGETHER_API_KEY`. Manifest stores it internally
via `POST /providers`.

## Verification Steps

```bash
# Ollama service health
systemctl status ollama --no-pager
curl -s http://localhost:11434/api/tags | python3 -m json.tool

# Verify models are loaded
ollama list

# Verify Manifest custom providers (both should show has_api_key: true)
docker exec openclaw-gateway curl -sf \
  http://127.0.0.1:2099/api/v1/routing/open-claw/custom-providers | python3 -m json.tool

# Verify Manifest tier routing
docker exec openclaw-gateway curl -sf \
  http://127.0.0.1:2099/api/v1/routing/open-claw/tiers | python3 -m json.tool

# Verify TOGETHER_API_KEY in container env
docker exec openclaw-gateway env | grep TOGETHER
```

## Rollback

### Revert Manifest tier routing to unset
```bash
for tier in small standard local-advanced advanced long-context thinking; do
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

**Manifest API returns empty / connection refused after container restart**
- The API takes ~12 seconds to initialize after container start
- Poll: `docker exec openclaw-gateway curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:2099/api/v1/routing/open-claw/custom-providers`
- Wait until it returns 200 before running the manifest playbook tag

**Together provider shows `has_api_key: false`**
- Check that `together_ai_api_key` is set in the Ansible vault
- Redeploy compose: `ansible-playbook playbooks/docker.yml --tags docker,configure`
- Restart container: `ansible-playbook playbooks/docker.yml --tags openclaw,service`
- Re-run routing: `ansible-playbook playbooks/ollama.yml --tags manifest`

**VRAM thrash / swap instability (local models)**
- Lower `OLLAMA_NUM_PARALLEL` to 1 in override.conf
- Reduce context in Manifest tier config

**Queue backups**
- Increase `OLLAMA_MAX_QUEUE` from 32 to 64
