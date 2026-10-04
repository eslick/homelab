# MinIO root credentials rotation

## Task
Replace the default MinIO root login (`minioadmin` / `changeme`) with user `admin` and the password
stored in `~/.ssh/internal-default.txt` on the operator's account. The password is read at deploy time,
never committed, and no longer written into the world-readable compose file.

## Playbook Used
`playbooks/docker.yml --tags minio`
- `minio_root_user: admin`; `minio_root_password` = `lookup('file', '~/.ssh/internal-default.txt') | trim`.
  The old `changeme` fallback is removed, so a missing file fails the run instead of using a weak default.
- New task writes `/opt/secrets/minio.env` (root:root, 0600, `no_log`).
- `templates/minio-compose.yml.j2` now uses `env_file: /opt/secrets/minio.env` instead of inline `environment:`.
- MinIO tasks gained a `minio` tag. Container was recreated; the `minio-data` volume is untouched.
- Pre-change: restic snapshot from 2026-10-04 03:00 present (covers /var/lib/docker/volumes).

## Verification Steps
- `POST /api/v1/login` on 127.0.0.1:9001 with `admin` + file password → 204; `minioadmin`/`changeme` → 401.
- Bucket `artifacts` still listed; console via nginx :9002 → 200.
- `/opt/compose/minio/docker-compose.yml` no longer contains credentials; `/opt/secrets/minio.env` is 0600 root.

## Rollback
To change the password later, edit `~/.ssh/internal-default.txt` and re-run `ansible-playbook playbooks/docker.yml --tags minio`
(note: the same file may be used for other services). To undo the structure, `git revert` this commit and
re-run the same command; restore a password source first, since there is no default any more.
