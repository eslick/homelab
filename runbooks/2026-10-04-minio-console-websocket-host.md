# MinIO console spinner: WebSocket Host header

## Task
The MinIO console (`https://speedracer.terrier-haddock.ts.net:9002`) showed a spinning loader on the
`artifacts` bucket page. The bucket is empty and the REST API answered in ~30 ms, both directly and
through nginx. The object browser lists objects over a WebSocket (`/ws/objectManager`), and that
handshake returned 403 through nginx but 101 when sent straight to MinIO.

Cause: the vhost forwarded `Host: $host`, which drops the port, while the browser's `Origin` includes
`:9002`. The console rejects a WebSocket whose Origin does not match Host.

## Playbook Used
`playbooks/nginx.yml --tags minio`: `templates/minio-nginx.conf.j2` now sets `proxy_set_header Host $http_host;`.

## Verification Steps
- `nginx -t` passes.
- WebSocket handshake via nginx with `Origin: https://speedracer.terrier-haddock.ts.net:9002` → 101 (was 403).
- Reload the console page in the browser; the bucket page loads.
- Other vhosts still use `$host`; Arcana's LiveView WebSocket was checked and returns 101, Home Assistant works.

## Rollback
`git revert` this commit and re-run `ansible-playbook playbooks/nginx.yml --tags minio`.
