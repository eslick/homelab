# UFW stale-rule cleanup and stray image removal

## Task
Remove firewall rules left by retired services and a test image pulled during diagnostics.
Nothing listens on 2099 / 18789 (OpenClaw), 5984 (Obsidian CouchDB) or 11434 (Ollama).
Kept on purpose: 8081/8082 (sglang), 22000 (Syncthing), 5353/udp (mDNS), 1400 from LAN (Sonos), 8123 from docker.
Also noted: `Anywhere on tailscale0 ALLOW` is deliberate (whole tailnet trusted); left unchanged.

## Playbook Used
- `playbooks/system.yml --tags cleanup`: new task "Remove stale UFW rules for retired services" (7 rule specs, idempotent).
- `playbooks/nginx.yml`: dropped `2099` from the tailnet allow loop (it was re-creating the rule).
- `playbooks/docker.yml --tags curl-image`: removes `curlimages/curl:latest` (pulled by an ad-hoc connectivity test).
- Dashboard text corrected: UFW "trusts tailscale0" instead of "allows per port".

## Verification Steps
- `sudo ufw status numbered`: no 2099 / 18789 / 5984 / 11434 entries; remaining rules as listed above.
- `docker images curlimages/curl` → empty.
- nginx vhosts still answer (443, 8124, 9002, 7001, 14000 → 200; 9000 unsigned → 403 as expected).
- Note: probing :8082 cold-starts the sglang container; it stops itself after the 300 s idle timeout.

## Rollback
`git revert` and re-run the playbooks. Re-adding the old rules is not recommended (services are retired).
The test image can be re-pulled if ever needed.
