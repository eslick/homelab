# Memory Index

- [Homelab network architecture](project_network_architecture.md) — Tailscale→nginx→localhost:port→container; all ports must be 127.0.0.1-bound; nginx is sole Tailscale ingress
- [RAID5 degraded - known state](project_raid5_degraded.md) — /dev/md0 running 3/4 disks [_UUU]; suppress DegradedArray alerts
- [vLLM config & model history](project_vllm_config.md) — current default is Gemma4 A3B; Ampere BF16 KV constraint; model switch commands
