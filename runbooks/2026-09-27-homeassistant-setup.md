# Home Assistant Setup

## Task
Deploy Home Assistant Core to launch on boot, with host networking for device
discovery, and confirm its API is reachable from other containers on
`homelab-net` (needed for future integration, e.g. from Arcana). Zigbee2MQTT
and Mosquitto were deferred — no Zigbee USB coordinator is attached yet.

## Playbook Used
`playbooks/homeassistant.yml` (new), rendering
`templates/homeassistant-compose.yml.j2` to
`/opt/compose/homeassistant/docker-compose.yml`.

Key decisions:
- `network_mode: host` — approved exception to the usual 127.0.0.1-bound
  convention. HA needs host networking for mDNS/SSDP/UPnP discovery
  (Cast, HomeKit, Sonos, etc.), which does not traverse a Docker bridge.
- Config persisted at `/opt/compose/homeassistant/config` (bind mount),
  so it's covered by the existing restic backup path.
- `restart: unless-stopped` + `docker.service` (already `enabled`) means
  no additional systemd unit was needed for boot persistence.
- UFW: `8123/tcp` allowed only from `172.18.0.0/16` (the `homelab-net`
  bridge subnet), not opened to the LAN or Tailscale.

Apply command used:
```
ansible-playbook playbooks/homeassistant.yml --check --diff   # dry run
ansible-playbook playbooks/homeassistant.yml                  # apply
```

## Verification Steps
1. `docker ps --filter name=homeassistant` → container `Up`, host-networked.
2. `sudo ss -tlnp | grep 8123` → confirmed `python3` (HA) listening on
   `0.0.0.0:8123` (host-wide, as expected under `network_mode: host`).
3. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8123` → `302`
   (HA onboarding redirect — service alive).
4. Cross-container reachability test:
   ```
   docker run --rm --network homelab-net curlimages/curl:latest \
     curl -s -o /dev/null -w '%{http_code}' http://172.18.0.1:8123
   ```
   → `302`, confirming any container on `homelab-net` can reach the HA
   API via the bridge gateway IP `172.18.0.1:8123`.
5. `sudo ufw status | grep 8123` → `8123/tcp ALLOW 172.18.0.0/16` only.

## Rollback
```
docker compose -f /opt/compose/homeassistant/docker-compose.yml down
sudo ufw delete allow from 172.18.0.0/16 to any port 8123 proto tcp
sudo rm -rf /opt/compose/homeassistant
git revert 39de30d
```
Config data under `/opt/compose/homeassistant/config` is included in the
existing restic backup path (`/opt/compose` → `/mnt/nas/backups/homelab`),
so a snapshot exists before this change per standing backup policy —
confirm with `restic snapshots` before deleting the config directory if
recovery may be needed later.

## Next Steps (not yet done)
- Complete the HA onboarding wizard at `http://<tailscale-ip>:8123` or via
  nginx once a vhost is added (not yet created — HA is currently reachable
  only from localhost, the Docker bridge, or a direct LAN/host connection,
  not through the existing Tailscale nginx ingress).
- Add Zigbee2MQTT + Mosquitto (on `homelab-net`, not host networking) once
  a Zigbee USB coordinator is available.
