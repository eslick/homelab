#!/usr/bin/env python3
"""
Benchmark an OpenAI-compatible inference server.

Modes:
  default              Sequential single-user: TTFT, fill rate (prefill tok/s), decode tok/s, TTS
  --concurrency N      N simultaneous requests: P50/P95/P99 TTFT + aggregate throughput
  --cache-test         Cache cold (unique prompts) vs warm (repeated prompt) TTFT
  --probe-context      Step through context lengths to find the hardware ceiling
"""

import argparse, json, sys, time, threading, statistics
import urllib.request, urllib.error

BASE_PROMPT = """\
You are a highly capable AI assistant. I need you to help me analyze a complex software \
architecture problem. We have a distributed system with multiple microservices communicating \
over a message bus. The system processes financial transactions in real-time, and we are \
experiencing latency spikes under high load. The services involved are: an API gateway, \
an authentication service, a transaction validator, a fraud detection engine powered by \
ML models, a ledger service that writes to a distributed database, and a notification \
service. Each service is deployed in Kubernetes with auto-scaling enabled. We are using \
Kafka for the message bus with 32 partitions. The fraud detection engine runs inference \
on a neural network for each transaction. Under normal load (500 TPS) everything is fine, \
but at 2000 TPS we see P99 latency spike from 50ms to 800ms. We have profiled the system \
and found that the fraud detection engine is the bottleneck — it takes 40ms per inference \
under normal load, but under high load the queue depth grows and requests pile up. \
The ML model is a transformer with 350M parameters, batched up to 64 requests. \
Please provide a detailed analysis of the bottleneck, explain what is likely happening \
at the systems level, and propose at least five concrete architectural improvements \
with their expected impact on latency and throughput. For each solution discuss \
tradeoffs, implementation complexity, and any risks.\
"""


def make_request(url, model, prompt, max_tokens):
    """Streaming request. Returns (result_dict, error_str)."""
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
                        # reasoning models emit delta.reasoning before delta.content
                        if delta.get("reasoning"):
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
        body = e.read().decode(errors="replace")[:200]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, str(e)

    if t_first is None and thinking_tokens > 0:
        return None, f"reasoning only — {thinking_tokens} thinking tokens, no content (increase max_tokens or use --reasoning-effort low)"
    if t_first is None:
        return None, "no output tokens received"

    t_end = time.perf_counter()
    ttft_ms = (t_first - t_start) * 1000
    decode_s = t_end - t_first
    total_s = t_end - t_start
    thinking_s = (t_first - t_thinking_start) if t_thinking_start else None

    return {
        "ttft_ms": round(ttft_ms, 1),
        "prompt_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "thinking_tokens": thinking_tokens if thinking_tokens > 0 else None,
        "thinking_s": round(thinking_s, 2) if thinking_s else None,
        "decode_tok_s": round(output_tokens / decode_s if decode_s > 0 else 0, 1),
        "total_s": round(total_s, 2),
        "fill_tok_s": round(prompt_tokens / (ttft_ms / 1000), 0) if prompt_tokens and ttft_ms > 0 else None,
    }, None


def pct(sorted_arr, p):
    if not sorted_arr:
        return 0
    return sorted_arr[min(len(sorted_arr) - 1, int(len(sorted_arr) * p / 100))]


# ── Sequential ───────────────────────────────────────────────────────────────

def run_sequential(url, model, prompt, max_tokens, runs, label):
    results = []
    print(f"\nSequential ({runs} runs)...", file=sys.stderr)
    for i in range(runs):
        r, err = make_request(url, model, prompt, max_tokens)
        if err:
            print(f"  run {i+1}: ERROR {err}", file=sys.stderr)
            continue
        r["run"] = i + 1
        results.append(r)
        fill = f"  fill={r['fill_tok_s']:.0f} ptok/s" if r["fill_tok_s"] else ""
        think = f"  thinking={r['thinking_s']:.1f}s/{r['thinking_tokens']}tok" if r.get("thinking_s") else ""
        print(f"  run {i+1}: TTFT={r['ttft_ms']:.0f}ms  {r['output_tokens']} tok  "
              f"{r['decode_tok_s']:.1f} tok/s  TTS={r['total_s']:.2f}s{fill}{think}", file=sys.stderr)

    if not results:
        print(f"\n## {label} — Sequential: all requests failed")
        return

    avg_ttft   = statistics.mean(r["ttft_ms"] for r in results)
    avg_decode = statistics.mean(r["decode_tok_s"] for r in results)
    avg_tts    = statistics.mean(r["total_s"] for r in results)
    fill_vals  = [r["fill_tok_s"] for r in results if r["fill_tok_s"]]

    print(f"\n## {label} — Sequential")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Runs | {len(results)} |")
    print(f"| Avg TTFT (to first content) | {avg_ttft:.0f} ms |")
    if fill_vals:
        print(f"| Avg fill rate (prefill) | {statistics.mean(fill_vals):.0f} tok/s |")
    thinking_vals = [r["thinking_s"] for r in results if r.get("thinking_s")]
    if thinking_vals:
        avg_think_s = statistics.mean(thinking_vals)
        avg_think_tok = statistics.mean(r["thinking_tokens"] for r in results if r.get("thinking_tokens"))
        print(f"| Avg thinking time | {avg_think_s:.1f} s |")
        print(f"| Avg thinking tokens | {avg_think_tok:.0f} |")
    print(f"| Avg decode throughput | {avg_decode:.1f} tok/s |")
    print(f"| Avg TTS | {avg_tts:.2f} s |")
    print(f"| Prompt tokens | {results[-1].get('prompt_tokens', 'n/a')} |")
    print(f"| Output tokens | {results[-1]['output_tokens']} |")
    print()
    print(f"| Run | TTFT (ms) | Fill (ptok/s) | Decode (tok/s) | TTS (s) |")
    print(f"|-----|-----------|---------------|----------------|---------|")
    for r in results:
        fill = f"{r['fill_tok_s']:.0f}" if r["fill_tok_s"] else "n/a"
        print(f"| {r['run']} | {r['ttft_ms']:.0f} | {fill} | {r['decode_tok_s']:.1f} | {r['total_s']:.2f} |")


# ── Concurrency ──────────────────────────────────────────────────────────────

def run_concurrency(url, model, prompt, max_tokens, concurrency, label):
    print(f"\nConcurrency={concurrency} simultaneous requests...", file=sys.stderr)

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
        with lock:
            wall_times["end"] = time.perf_counter()
        if err:
            errors.append(err)
            print(f"  worker {idx}: ERROR {err}", file=sys.stderr)
        else:
            slot_results[idx] = r
            print(f"  worker {idx}: TTFT={r['ttft_ms']:.0f}ms  {r['decode_tok_s']:.1f} tok/s", file=sys.stderr)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    valid = [r for r in slot_results if r is not None]
    if not valid:
        print(f"\n## {label} — Concurrency={concurrency}: all requests failed")
        return

    ttfts = sorted(r["ttft_ms"] for r in valid)
    total_output = sum(r["output_tokens"] for r in valid)
    wall = wall_times["end"] - wall_times["start"] if wall_times["start"] and wall_times["end"] else None

    print(f"\n## {label} — Concurrency={concurrency}")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Requests | {len(valid)}/{concurrency} succeeded |")
    print(f"| P50 TTFT | {pct(ttfts, 50):.0f} ms |")
    print(f"| P95 TTFT | {pct(ttfts, 95):.0f} ms |")
    print(f"| P99 TTFT | {pct(ttfts, 99):.0f} ms |")
    print(f"| Min TTFT | {ttfts[0]:.0f} ms |")
    print(f"| Max TTFT | {ttfts[-1]:.0f} ms |")
    if wall:
        print(f"| Aggregate throughput | {total_output / wall:.1f} tok/s |")
        print(f"| Wall time | {wall:.1f} s |")


# ── Cache test ───────────────────────────────────────────────────────────────

def run_cache_test(url, model, base_prompt, max_tokens, runs, label):
    print(f"\nCache test ({runs} rounds each)...", file=sys.stderr)

    def collect(prompt_fn, tag):
        results = []
        print(f"  {tag}:", file=sys.stderr)
        for i in range(runs):
            r, err = make_request(url, model, prompt_fn(i), max_tokens)
            if err:
                print(f"    run {i+1}: ERROR {err}", file=sys.stderr)
            else:
                results.append(r)
                print(f"    run {i+1}: TTFT={r['ttft_ms']:.0f}ms", file=sys.stderr)
        return results

    warm = collect(lambda _: base_prompt, "Warm (repeated prompt — cache hit)")
    cold = collect(lambda i: base_prompt + f"\n\n<!-- unique:{i}-{time.time()} -->",
                   "Cold (unique suffix — cache miss)")

    if not warm or not cold:
        return

    avg_warm = statistics.mean(r["ttft_ms"] for r in warm)
    avg_cold = statistics.mean(r["ttft_ms"] for r in cold)
    speedup = avg_cold / avg_warm if avg_warm > 0 else None

    print(f"\n## {label} — Cache Performance")
    print(f"| Condition | Avg TTFT | vs cold |")
    print(f"|-----------|----------|---------|")
    print(f"| Cache cold (unique prompts) | {avg_cold:.0f} ms | 1.0× |")
    print(f"| Cache warm (repeated prompt) | {avg_warm:.0f} ms | {speedup:.1f}× faster |")


# ── Context probe ────────────────────────────────────────────────────────────

def _prompt_of_tokens(target_tokens, output_tokens):
    # ~1.3 tokens/word; pad with a paragraph repeated to fill target length
    unit = ("The quick brown fox jumps over the lazy dog. " * 8) + "\n"  # ~60 tokens
    units = max(1, (target_tokens - output_tokens - 64) // 60)
    return (unit * units).strip() + "\n\nSummarise the above in one sentence."


def run_probe_context(url, model, max_tokens, label):
    print(f"\nProbing max context length...", file=sys.stderr)

    steps = [4_096, 8_192, 16_384, 32_768, 65_536, 131_072]
    outcomes = {}
    last_ok = 0

    for ctx in steps:
        prompt = _prompt_of_tokens(ctx, max_tokens)
        print(f"  Trying {ctx:,} tokens...", file=sys.stderr)
        r, err = make_request(url, model, prompt, max_tokens)
        if err:
            outcomes[ctx] = f"✗ FAILED — {err[:80]}"
            print(f"    FAILED: {err[:80]}", file=sys.stderr)
            for remaining in steps[steps.index(ctx) + 1:]:
                outcomes[remaining] = "— (skipped)"
            break
        else:
            last_ok = ctx
            outcomes[ctx] = f"✓ OK — TTFT={r['ttft_ms']:.0f}ms, decode={r['decode_tok_s']:.1f} tok/s"
            print(f"    OK  TTFT={r['ttft_ms']:.0f}ms  {r['decode_tok_s']:.1f} tok/s", file=sys.stderr)

    print(f"\n## {label} — Context Length Probe")
    print(f"| Context (tokens) | Result |")
    print(f"|-----------------|--------|")
    for ctx in steps:
        print(f"| {ctx:,} | {outcomes.get(ctx, '— (not reached)')} |")
    if last_ok:
        print(f"\n**Max confirmed context: {last_ok:,} tokens**")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Benchmark an OpenAI-compatible inference server")
    ap.add_argument("--url", default="http://127.0.0.1:8081")
    ap.add_argument("--model", required=True)
    ap.add_argument("--max-tokens", type=int, default=300)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--prompt", default=None, help="Path to prompt file (default: built-in ~300-token prompt)")
    ap.add_argument("--label", default=None)
    ap.add_argument("--concurrency", type=int, default=0, help="N parallel requests (0=skip)")
    ap.add_argument("--cache-test", action="store_true")
    ap.add_argument("--probe-context", action="store_true")
    args = ap.parse_args()

    prompt = BASE_PROMPT
    if args.prompt:
        with open(args.prompt) as f:
            prompt = f.read()

    label = args.label or f"{args.url} ({args.model})"
    print(f"Benchmarking {label}", file=sys.stderr)
    print(f"  url={args.url}  model={args.model}  max_tokens={args.max_tokens}", file=sys.stderr)

    run_sequential(args.url, args.model, prompt, args.max_tokens, args.runs, label)

    if args.concurrency > 0:
        run_concurrency(args.url, args.model, prompt, args.max_tokens, args.concurrency, label)

    if args.cache_test:
        run_cache_test(args.url, args.model, prompt, args.max_tokens, args.runs, label)

    if args.probe_context:
        run_probe_context(args.url, args.model, args.max_tokens, label)


if __name__ == "__main__":
    main()
