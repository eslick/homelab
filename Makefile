VAULT := --vault-password-file ~/.vault_pass

.PHONY: upgrade-arcana check-arcana \
        sglang-moe sglang-dense sglang-status

# ── Arcana ────────────────────────────────────────────────────────────────────

upgrade-arcana:
	ansible-playbook playbooks/upgrade-arcana.yml

check-arcana:
	ansible-playbook playbooks/upgrade-arcana.yml --check --diff

# ── SGLang model switching ────────────────────────────────────────────────────
# Switches the active model and redeploys SGLang + watcher.
# SGLang starts on first inference request (watcher manages lifecycle).
#
# Usage:
#   make sglang-moe     # Qwen3.6-35B-A3B-AWQ  (MoE, fast, ~133 tok/s)
#   make sglang-dense   # Qwen3-32B-AWQ         (dense, higher quality)
#   make sglang-status  # show current model and watcher state

sglang-moe:
	ansible-playbook playbooks/sglang.yml $(VAULT) -e @vars/sglang-qwen3-moe.yml

sglang-dense:
	ansible-playbook playbooks/sglang.yml $(VAULT) -e @vars/sglang-qwen3-dense.yml

sglang-status:
	@echo "=== Watcher status ==="
	@curl -s http://localhost:8081/watcher/status | python3 -m json.tool
	@echo ""
	@echo "=== Running containers ==="
	@docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" | grep -E "sglang|NAMES"
	@echo ""
	@echo "=== Active model config ==="
	@docker inspect sglang --format 'Image: {{.Config.Image}}' 2>/dev/null || echo "sglang container not found"
	@docker inspect sglang --format 'Command: {{.Config.Cmd}}' 2>/dev/null | tr ',' '\n' | grep model-path || true
