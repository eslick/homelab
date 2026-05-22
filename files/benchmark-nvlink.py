#!/usr/bin/env python3
"""
NVLink benchmark — Qwen3.6-27B dense on dual RTX 3090.

Tests sequential (single caller) and 8-way concurrent requests
at 16K and 64K context lengths, reporting per-chain and aggregate
throughput for comparison against the pre-NVLink PCIe-only baseline.
"""

import argparse, json, sys, time, threading, statistics
import urllib.request, urllib.error

# Substantive technical paragraph (~120 tokens) repeated to fill context.
# Meaningful content prevents the model entering a degenerate reasoning loop.
FILL_UNIT = (
    "A distributed financial transaction system processes 2,000 TPS across six microservices: "
    "an API gateway, an authentication service, a transaction validator, a fraud detection engine "
    "running a 350M-parameter transformer model, a ledger service writing to a distributed database, "
    "and a notification service. Under normal load the P99 latency is 50ms, but at peak load "
    "the fraud detection engine becomes a bottleneck — inference queues grow and P99 spikes to 800ms. "
    "The Kafka message bus has 32 partitions and the fraud model is batched up to 64 requests.\n"
)
FILL_UNIT_TOKENS = 120
TASK_SUFFIX = (
    "\n\nBased on the system description above, provide a detailed analysis: "
    "(1) identify the primary bottleneck and explain the queueing theory behind it, "
    "(2) describe at least five concrete architectural improvements with expected latency impact, "
    "(3) discuss the tradeoffs and implementation complexity of each solution. /no_think"
)
TASK_SUFFIX_TOKENS = 70


def build_prompt(target_input_tokens):
    """Build a prompt of approximately target_input_tokens tokens."""
    needed = max(1, (target_input_tokens - TASK_SUFFIX_TOKENS) // FILL_UNIT_TOKENS)
    return (FILL_UNIT * needed).strip() + TASK_SUFFIX


def make_request(url, model, prompt, max_tokens):
    """Streaming SSE request. Returns (result_dict, error_str)."""
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
        "temperature": 0.0,
    }).encode()

    req = urllib.request.Request(
        f"{url}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    t_start = time.perf_counter()
    t_first = None
    output_tokens = 0
    prompt_tokens = None

    t_thinking_start = None
    thinking_tokens = 0

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            for raw in resp:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    if chunk.get("usage"):
                        prompt_tokens = chunk["usage"].get("prompt_tokens")
                    choices = chunk.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        if delta.get("reasoning_content"):
                            if t_thinking_start is None:
                                t_thinking_start = time.perf_counter()
                            thinking_tokens += 1
                        if delta.get("content"):
                            if t_first is None:
                                t_first = time.perf_counter()
                            output_tokens += 1
                except (json.JSONDecodeError, KeyError):
                    continue
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, str(e)

    if t_first is None and thinking_tokens > 0:
        return None, f"reasoning-only: {thinking_tokens} thinking tokens, no content (raise max_tokens)"
    if t_first is None:
        return None, "no output tokens received"

    t_end = time.perf_counter()
    decode_s = t_end - t_first
    thinking_s = (t_first - t_thinking_start) if t_thinking_start else None

    return {
        "ttft_ms": round((t_first - t_start) * 1000, 1),
        "prompt_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "thinking_tokens": thinking_tokens if thinking_tokens > 0 else None,
        "thinking_s": round(thinking_s, 2) if thinking_s else None,
        "decode_tok_s": round(output_tokens / decode_s if decode_s > 0 else 0, 1),
        "total_s": round(t_end - t_start, 2),
        "fill_tok_s": round(prompt_tokens / ((t_first - t_start)) if prompt_tokens and (t_first - t_start) > 0 else 0, 0),
    }, None


def pct(sorted_arr, p):
    if not sorted_arr:
        return 0
    return sorted_arr[min(len(sorted_arr) - 1, int(len(sorted_arr) * p / 100))]


def run_sequential(url, model, prompt, max_tokens, runs, section_label):
    results = []
    print(f"\n[sequential] {section_label} — {runs} runs ...", file=sys.stderr)
    for i in range(runs):
        r, err = make_request(url, model, prompt, max_tokens)
        if err:
            print(f"  run {i+1}: ERROR {err}", file=sys.stderr)
            continue
        r["run"] = i + 1
        results.append(r)
        print(f"  run {i+1}: TTFT={r['ttft_ms']:.0f}ms  out={r['output_tokens']} tok  "
              f"decode={r['decode_tok_s']:.1f} tok/s  TTS={r['total_s']:.2f}s  "
              f"fill={r['fill_tok_s']:.0f} ptok/s", file=sys.stderr)

    if not results:
        print(f"\n### {section_label} — Sequential: all requests failed\n")
        return

    avg_ttft   = statistics.mean(r["ttft_ms"] for r in results)
    avg_decode = statistics.mean(r["decode_tok_s"] for r in results)
    avg_tts    = statistics.mean(r["total_s"] for r in results)
    avg_fill   = statistics.mean(r["fill_tok_s"] for r in results if r["fill_tok_s"])

    print(f"\n### {section_label} — Sequential ({runs} runs)\n")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Avg TTFT | {avg_ttft:.0f} ms |")
    print(f"| Avg prefill rate | {avg_fill:.0f} tok/s |")
    print(f"| Avg decode throughput | {avg_decode:.1f} tok/s |")
    print(f"| Avg TTS | {avg_tts:.2f} s |")
    print(f"| Prompt tokens (approx) | {results[-1].get('prompt_tokens', 'n/a')} |")
    print(f"| Output tokens | {results[-1]['output_tokens']} |")
    print()
    print(f"| Run | TTFT (ms) | Prefill (tok/s) | Decode (tok/s) | TTS (s) |")
    print(f"|-----|-----------|-----------------|----------------|---------|")
    for r in results:
        print(f"| {r['run']} | {r['ttft_ms']:.0f} | {r['fill_tok_s']:.0f} | {r['decode_tok_s']:.1f} | {r['total_s']:.2f} |")
    print()


def run_concurrent(url, model, prompt, max_tokens, concurrency, section_label):
    print(f"\n[concurrent/{concurrency}] {section_label} ...", file=sys.stderr)

    slot_results = [None] * concurrency
    errors = []
    barrier = threading.Barrier(concurrency)
    wall_times = {"start": None, "end": None}
    lock = threading.Lock()

    def worker(idx):
        barrier.wait()
        with lock:
            if wall_times["start"] is None:
                wall_times["start"] = time.perf_counter()
        r, err = make_request(url, model, prompt, max_tokens)
        t_done = time.perf_counter()
        with lock:
            if wall_times["end"] is None or t_done > wall_times["end"]:
                wall_times["end"] = t_done
        if err:
            errors.append(err)
            print(f"  worker {idx}: ERROR {err}", file=sys.stderr)
        else:
            slot_results[idx] = r
            print(f"  worker {idx}: TTFT={r['ttft_ms']:.0f}ms  "
                  f"decode={r['decode_tok_s']:.1f} tok/s  TTS={r['total_s']:.2f}s", file=sys.stderr)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    valid = [r for r in slot_results if r is not None]
    if not valid:
        print(f"\n### {section_label} — Concurrent/{concurrency}: all failed\n")
        return

    ttfts = sorted(r["ttft_ms"] for r in valid)
    total_output = sum(r["output_tokens"] for r in valid)
    wall = wall_times["end"] - wall_times["start"] if wall_times["start"] and wall_times["end"] else None
    agg_tps = total_output / wall if wall else None

    avg_chain_decode = statistics.mean(r["decode_tok_s"] for r in valid)
    avg_chain_ttft   = statistics.mean(r["ttft_ms"] for r in valid)

    print(f"\n### {section_label} — Concurrent ({concurrency} threads)\n")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Requests | {len(valid)}/{concurrency} succeeded |")
    print(f"| P50 TTFT | {pct(ttfts, 50):.0f} ms |")
    print(f"| P95 TTFT | {pct(ttfts, 95):.0f} ms |")
    print(f"| Min TTFT | {ttfts[0]:.0f} ms |")
    print(f"| Max TTFT | {ttfts[-1]:.0f} ms |")
    print(f"| Avg per-chain TTFT | {avg_chain_ttft:.0f} ms |")
    print(f"| Avg per-chain decode | {avg_chain_decode:.1f} tok/s |")
    if agg_tps:
        print(f"| Aggregate throughput | {agg_tps:.1f} tok/s |")
        print(f"| Wall time | {wall:.1f} s |")
    print()
    print(f"| Chain | TTFT (ms) | Decode (tok/s) | Output tokens | TTS (s) |")
    print(f"|-------|-----------|----------------|---------------|---------|")
    for i, r in enumerate(slot_results):
        if r:
            print(f"| {i} | {r['ttft_ms']:.0f} | {r['decode_tok_s']:.1f} | {r['output_tokens']} | {r['total_s']:.2f} |")
        else:
            print(f"| {i} | — | — | — | FAILED |")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8081")
    ap.add_argument("--model", required=True)
    ap.add_argument("--max-tokens", type=int, default=8192)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--context-sizes", default="16384,65536",
                    help="Comma-separated target input token counts")
    ap.add_argument("--label", default="NVLink Benchmark")
    args = ap.parse_args()

    ctx_sizes = [int(x.strip()) for x in args.context_sizes.split(",")]

    print(f"# {args.label}\n")
    print(f"**URL**: {args.url}  **Model**: {args.model}  "
          f"**max_tokens**: {args.max_tokens}  **runs**: {args.runs}  "
          f"**concurrency**: {args.concurrency}\n")
    print(f"**Context sizes tested**: {', '.join(f'{c:,}' for c in ctx_sizes)} input tokens\n")

    for ctx in ctx_sizes:
        prompt = build_prompt(ctx)
        ctx_label = f"{ctx // 1024}K ctx"
        section = f"{ctx_label}"

        print(f"\n## Context ≈ {ctx:,} tokens ({ctx // 1024}K)\n")

        run_sequential(args.url, args.model, prompt, args.max_tokens,
                       args.runs, section)
        run_concurrent(args.url, args.model, prompt, args.max_tokens,
                       args.concurrency, section)

    print("\n---\n")
    print("*Generated by `files/benchmark-nvlink.py`*\n")


if __name__ == "__main__":
    main()
