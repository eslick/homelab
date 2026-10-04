# Arcana 2 provider secrets

## Task
Provision all Arcana 2 provider keys on speedracer from the Ansible vault into one root-protected
env file, per the arcana2 session's handoff (`homelab-arcana2-secrets.md`). Source values came from an
operator-assembled env file; they are now in the vault, which is the source of truth.

## Playbook Used
`playbooks/arcana2.yml --tags secrets`
- Vault (`group_vars/all.yml`, `ansible-vault`, password file `~/.vault_pass`): added
  `vault_perplexity_api_key`, `vault_google_client_id`, `vault_google_client_secret`,
  `vault_discord_bot_token`, `vault_telegram_bot_token`, `vault_fluxon_license_key`.
  OpenAI, Together and Hugging Face reuse the existing vars (`vault_openai_api_key`, `together_ai_api_key`,
  `hugging_face_token`); values were identical to the source file. Anthropic keeps the existing
  `vault_anthropic_api_key` (both keys tested valid; they differ).
- `arcana2_provider_secrets` (ENV_NAME → vault var, `default('')` for optional ones) drives the
  `/opt/secrets/arcana2.env` task: 0600, owner `eslick` (the repo compose reads it client-side), `no_log`, blanks skipped.
- Not yet created, so absent from the file: `VOYAGE_API_KEY`, `GEMINI_API_KEY`, `BRAVE_API_KEY`, `GOOGLE_API_KEY`.
- Containers are NOT touched by this tag. The running two-node cluster is started by the arcana2 repo's
  `docker/compose.dev.yml` (`make dev.up`); it must list `/opt/secrets/arcana2.env` as an `env_file`
  (optional entry) and then be recreated with `make dev.down dev.up`.

## Verification Steps
- `ls -l /opt/secrets/arcana2.env` → `-rw------- eslick eslick`.
- Key names only: `sed -E 's/=.*/=<hidden>/' /opt/secrets/arcana2.env` → 10 keys, no blanks.
- After the compose line is added and the cluster recreated: `docker exec arcana-dev env | cut -d= -f1 | grep -E 'KEY|TOKEN|SECRET|CLIENT'`
  lists the keys; in `make dev.iex`, `Arcana.Core.Secrets.known_keys()` and `source(:together_api_key)` → `:env`.
- Never print values.

## Add or rotate a key
1. `ansible-vault edit group_vars/all.yml` — add or change the `vault_*` value (names are listed in `arcana2_provider_secrets`).
2. `ansible-playbook playbooks/arcana2.yml --check --tags secrets`, then without `--check`.
3. Recreate the nodes so they re-read the env file: `make dev.down dev.up` in `~/projects/arcana2`.
4. Commit the vault change (encrypted) and note it here.

## Rollback
`git revert` the commit and re-run `--tags secrets`; the file reverts to Anthropic-only. The previous vault is in git history.
Delete the plaintext source copies (`~/arcana2-speedracer.env` here, `~/.ssh/arcana2-speedracer.env` on the Mac)
once the cluster verifies.
