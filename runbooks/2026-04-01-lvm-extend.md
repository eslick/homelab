## Task
Extend root logical volume from 100GB to use all available space on the 1TB NVMe drive.

## Playbook Used
`playbooks/lvm-extend.yml`

```bash
ansible-playbook playbooks/lvm-extend.yml
```

## Verification Steps
1. `df -h /` — should show ~914GB
2. `sudo lvs` — ubuntu-lv should show ~928GB

## Rollback
LVM extend is not easily reversible without data loss. To shrink, you would need to:
1. Boot from live USB
2. `e2fsck -f /dev/ubuntu-vg/ubuntu-lv`
3. `resize2fs /dev/ubuntu-vg/ubuntu-lv <size>`
4. `lvreduce -L <size> ubuntu-vg/ubuntu-lv`
