# SGLang tool-call parser: qwen -> qwen3_coder

## Task
Qwen3.6-35B-A3B emits Qwen3-Coder XML tool calls. With `--tool-call-parser qwen`, auto tool choice returned `tool_calls: []` (XML left in `content`) and streams had no tool-call deltas. Switched to `qwen3_coder`. Idle timeout deliberately left at 300 s.

## Playbook Used
`playbooks/sglang.yml --tags configure,docker,sglang` (default `sglang_extra_args`); `vars/sglang-qwen3-moe.yml` updated to match. The BROKEN dense profile was not touched. Became-root tasks: compose dir/template, image check, watcher build, container rm/create, watcher start, ufw rules. The GPU container is recreated (stopped until the next request wakes it).

## Verification Steps
1. `docker inspect sglang --format '{{.Config.Cmd}}' | grep tool-call-parser` shows `qwen3_coder`.
2. Wake the model: `curl -s localhost:8081/v1/models` (~90 s cold).
3. POST `/v1/chat/completions` with a `get_weather` tool, `max_tokens: 8192`, no `tool_choice`: expect `finish_reason: tool_calls` and populated `message.tool_calls` (5/5 on 2026-10-06). Repeat with `stream: true`: expect `delta.tool_calls` chunks.
4. Plain chat without tools still returns normal content.

## Rollback
Set `--tool-call-parser qwen` back in `playbooks/sglang.yml` and `vars/sglang-qwen3-moe.yml` (or `git revert` the commit) and re-run `ansible-playbook playbooks/sglang.yml --tags configure,docker,sglang`. Tool calls then only work with forced `tool_choice`.
