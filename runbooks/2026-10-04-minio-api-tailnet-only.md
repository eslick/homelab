# MinIO S3 API restricted to the tailnet

## Task
The S3 API (`:9000`) was published on all interfaces (`0.0.0.0:9000`, plus a UFW "allow from anywhere"),
so any device on the LAN could reach it. Restrict it to the tailnet, following the homelab rule that nginx
is the only ingress and container ports bind to 127.0.0.1.

## Playbook Used
- `playbooks/docker.yml --tags minio`: minio `ports: []`, compose binds `127.0.0.1:9000:9000`;
  `minio_api_port` added to `admin_console_ports` (removes the blanket UFW allow, adds a localhost-only rule);
  the two UFW tasks gained the `minio` tag.
- `playbooks/nginx.yml --tags minio`: new `templates/minio-api-nginx.conf.j2` (TLS vhost on the tailnet IP :9000,
  MinIO-recommended proxy settings, `Host $http_host` so SigV4 signatures match), enabled site, UFW allow
  9000 on `tailscale0`.
- Order matters: docker.yml first (frees `0.0.0.0:9000`), then nginx.yml (binds `100.74.60.51:9000`).
- Pre-change: restic snapshot 2026-10-04 03:00 present.

## Verification Steps
- `ss -ltn | grep :9000` shows only `127.0.0.1:9000` (docker) and `100.74.60.51:9000` (nginx).
- `ufw status numbered`: no "9000 Anywhere"; `9000 ALLOW 127.0.0.1` and `9000 on tailscale0`.
- `curl --aws-sigv4 "aws:amz:us-east-1:s3" --user admin:<pw> https://speedracer.terrier-haddock.ts.net:9000/artifacts?list-type=2` → 200; wrong password → 403.
- `http://192.168.50.100:9000` (LAN IP) no longer answers. Containers on homelab-net still use `http://minio:9000`.

## Client note
S3 clients on the tailnet use endpoint `https://speedracer.terrier-haddock.ts.net:9000` (path-style addressing,
region `us-east-1`).

## Rollback
`git revert` this commit; re-run `ansible-playbook playbooks/docker.yml --tags minio` then
`ansible-playbook playbooks/nginx.yml --tags minio`; remove `/etc/nginx/sites-{available,enabled}/minio-api`
and the `9000 on tailscale0` UFW rule if you want a clean state.
