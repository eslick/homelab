## Task
Configure idle power management: HDD spindown (30-minute timer) and persistent `schedutil` CPU governor.

## Playbook Used
`playbooks/power.yml` — tags: `install`, `configure`

## Changes Made

### HDD Spindown (sda, sdb — WD Red 3.6TB RAID5)
- `/etc/hdparm.conf` — sets `spindown_time = 241` (30 minutes) for `/dev/sda` and `/dev/sdb`
- `/etc/udev/rules.d/69-hdparm.rules` — re-applies spindown on disk attach/reboot
- WD Red drives do **not** support standard ATA APM (`-B`); only the `-S` standby timer works
- Drives spin up automatically on any RAID or filesystem access

### CPU Governor Persistence
- `/etc/default/cpufrequtils` — sets `GOVERNOR="schedutil"` to survive reboots
- `schedutil` was already active but would revert to `ondemand` on boot
- CPU c-states are limited to C1/C2 by TRX40 HEDT ACPI firmware — deeper sleep not available without `amd_pstate` kernel param (not done; higher risk)

### Not Changed / Already Optimal
- NVMe APST: already enabled by kernel default (`/sys/class/nvme/nvme*/device/power/control` = `auto`)
- GPU idle power: RTX 3090 already enters P8 (~15-17W each) when SGLang is idle

## Estimated Savings
- HDD spindown: ~10-12W when both drives are spun down
- Governor persistence: minor, prevents occasional ondemand spike on boot
- Remaining dominant idle CPU consumer: CockroachDB (~6-7% CPU) — tunable via docker-compose CPU limits in `playbooks/docker.yml` if needed

## Verification Steps
```bash
# Confirm spindown timeout is active (value 241 = 30 min)
sudo hdparm -S /dev/sda  # note: -S without value queries; WD Red may show 0 but timer is active

# Confirm udev rule exists
cat /etc/udev/rules.d/69-hdparm.rules

# Wait 30+ minutes with no disk I/O, then check:
sudo hdparm -C /dev/sda /dev/sdb
# Expected: "drive state is: standby"

# Confirm governor persistent config
cat /etc/default/cpufrequtils

# Confirm governor is currently active
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

## Rollback
```bash
# Remove spindown config
sudo rm /etc/hdparm.conf  # or restore default from package: sudo dpkg-reconfigure hdparm
sudo rm /etc/udev/rules.d/69-hdparm.rules

# Restore drives to always-on
sudo hdparm -S 0 /dev/sda /dev/sdb

# Remove governor persistence
sudo rm /etc/default/cpufrequtils
```
