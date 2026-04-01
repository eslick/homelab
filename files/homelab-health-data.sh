#!/bin/bash
# Collect all health check data in one pass.
# Outputs structured markdown consumed by homelab-health-check.sh.
# No network calls, no Claude — just local system queries.

echo "## Disk Usage"
echo '```'
df -h --output=target,pcent,size,used,avail -x tmpfs -x devtmpfs | tail -n +2
echo '```'
echo ""

echo "## Memory Usage"
echo '```'
free -h
MEM_USED_PCT=$(free | awk '/^Mem:/ {printf "%.0f", $3/$2*100}')
echo "Used: ${MEM_USED_PCT}%"
echo '```'
echo ""

echo "## Docker Containers"
echo '```'
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || echo "docker not available"
echo '```'
echo ""

echo "## Restic Last Snapshot"
echo '```'
sudo restic --password-file /etc/restic/password \
            --repo /mnt/nas/backups/homelab \
            snapshots --latest 1 2>/dev/null || echo "restic query failed"
echo '```'
echo ""

echo "## Failed Systemd Units"
echo '```'
systemctl --failed --no-pager 2>/dev/null
echo '```'
echo ""

echo "## Pending Security Updates"
echo '```'
apt list --upgradable 2>/dev/null | grep -i security || echo "none"
echo '```'
