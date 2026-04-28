## Task
Diagnose and recover RAID5 array (/dev/md0) after hot-swap session. Array was inactive due to bad SATA cables. Identified dead port, replaced cables, reassembled array with new spare drive, mounted at /mnt/data.

## Root Cause
- One motherboard SATA port confirmed dead (drive disappeared when moved to that port with known-good cable)
- Multiple bad SATA data cables caused drives to intermittently not appear after hot swap
- Array was previously inactive/unassembled (not degraded-running)

## Drives
All four WD Red 3.6TB (WDC WD40EFRX-68WT0N0), SMART PASSED on all:
| Serial | Role |
|--------|------|
| WD-WCC4E0RX4E5E | Original member |
| WD-WCC4E1HDC758 | Original member |
| WD-WCC4E4JN39VP | Original member |
| WD-WCC4E1353691 | New spare (0 power-on hours, added as rebuild target) |

## Recovery Steps
```bash
# Trigger SCSI rescan after hot swap
for host in /sys/class/scsi_host/host*/scan; do echo "- - -" | sudo tee "$host" > /dev/null; done

# Examine drives for RAID metadata
sudo mdadm --examine /dev/sdc1 /dev/sdf1 /dev/sdg1

# Stop stale inactive array
sudo mdadm --stop /dev/md0

# Reassemble with 3 known members (degraded)
sudo mdadm --assemble /dev/md0 /dev/sdc1 /dev/sdf1 /dev/sdg1

# Flush multipath false-positive on new drive
sudo multipath -f mpatha

# Partition new drive to match existing layout
sudo sfdisk /dev/sde <<EOF
label: gpt
start=2048, type=linux
EOF

# Add new drive as spare/rebuild target
sudo mdadm /dev/md0 --add /dev/sde1
```

## Playbook Used
`playbooks/nas.yml` — tags: `raid`
- Creates /mnt/data mount point
- Adds UUID-based fstab entry with nofail,_netdev
- Updates /etc/mdadm/mdadm.conf
- Runs update-initramfs

## Rebuild Status
Rebuild started at ~128 MB/s, estimated ~8 hours total. Array is [_UUU] during rebuild — readable but degraded.

Monitor with: `cat /proc/mdstat`

## Multipath Issue
multipathd incorrectly claimed the new WD drive (sde) as a multipath device. Flushed with `multipath -f mpatha`. Blacklisting local SATA drives in multipath config is a TODO — see power.yml or create a dedicated playbook.

## Verification Steps
```bash
# Check rebuild progress
cat /proc/mdstat

# Confirm mount
df -h /mnt/data

# Confirm fstab
grep 494b6fb6 /etc/fstab

# After rebuild completes, confirm clean state
sudo mdadm --detail /dev/md0 | grep State
# Expected: clean
```

## Rollback
Array can be stopped with `sudo mdadm --stop /dev/md0` if needed.
Data is safe as long as at least 3 of 4 drives are healthy (RAID5 parity).

## Notes
- Dead SATA port: avoid using it — route remaining drives to working ports
- Replace bad SATA cables; locking-latch cables stress-fail during hot swap
- The MEMORY.md entry for "RAID5 degraded [_UUU]" was stale — array was actually inactive, not degraded-running
