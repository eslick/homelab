## Task

Remove homedev from the homelab. The Clojure-orchestrator approach is deprecated for now (user decision). Resumable: the source tree `~/projects/homedev` (and its `.claude/` directory) was deliberately left untouched.

## Playbook Used

- `playbooks/retire-homedev.yml --tags remove` (new; tag `never`): homedev container, image `homedev:local`, `/opt/compose/homedev`, `/usr/local/bin/homedev` wrapper, nginx site (:3001), UFW rule 3001/tailscale0, the YugabyteDB `homedev` database (had 0 tables), and the MinIO `homedev` bucket (empty; removed with `mc rb` without `--force`, which refuses a non-empty bucket).
- Cleanup of definitions: homedev removed from `playbooks/docker.yml` (service entry, build/start tasks, bucket task, the now-unused YugabyteDB database list/create tasks), `playbooks/nginx.yml` (vars, vhost tasks, UFW loop item) and `playbooks/system.yml` (wrapper and `.claude` config tasks); `templates/homedev-compose.yml.j2` and `templates/homedev-nginx.conf.j2` deleted.
- Re-ran dry runs of `docker.yml`, `nginx.yml`, `system.yml`: no pending diffs besides the long-standing always-changed tasks (MinIO image build, GitHub CLI key refresh) and the ignored `systemd-timesyncd` failure.

No volumes existed for homedev. There was no data to preserve.

## Verification Steps

```
docker ps -a --filter name=homedev          # none
docker images | grep homedev                # none
ls /opt/compose; ls /usr/local/bin/homedev  # homedev gone
ls /etc/nginx/sites-enabled; sudo nginx -t  # no homedev; config ok
sudo ufw status | grep 3001                 # none
docker exec yugabytedb ysqlsh -h yugabytedb -U yugabyte -tAc "select datname from pg_database"   # no homedev
ls ~/projects/homedev                       # source intact
```

## Rollback

`git revert` the homedev removal commit to restore the template and tasks, then `ansible-playbook playbooks/docker.yml --tags homedev,configure,service`, `playbooks/nginx.yml --tags homedev`, `playbooks/system.yml --tags claude`. The database/bucket were empty and are recreated by the old tasks. homedev read its DB URL from `CRDB_URL`; point that at YugabyteDB (`jdbc:postgresql://localhost:5433/homedev?user=yugabyte`), since Cockroach no longer exists.

## Notes

- Memory note `project_homedev_setup.md` marked deprecated (facts kept for resuming).
- MinIO's root password is still the playbook default `changeme` (verified: `mc` authenticates with it), and the S3 API port 9000 is open to anywhere in UFW. Pre-existing and unrelated to this change; recommend setting `MINIO_ROOT_PASSWORD`/a vaulted value and restricting 9000 to loopback or `homelab-net`.
