#!/usr/bin/env python3
"""Measure TTFT and decode throughput against any OpenAI-compatible inference server."""

import argparse, json, sys, time
import urllib.request

LONG_PROMPT = """\
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

def benchmark(url: str, model: str, prompt: str, max_tokens: int, runs: int):
    results = []
    for i in range(runs):
        payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "stream": True,
            "temperature": 0.0,
        }).encode()

        req = urllib.request.Request(
            f"{url}/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json"},
        )

        t_start = time.perf_counter()
        t_first = None
        token_count = 0

        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"]
                    if delta.get("content"):
                        if t_first is None:
                            t_first = time.perf_counter()
                        token_count += 1
                except (json.JSONDecodeError, KeyError):
                    continue

        t_end = time.perf_counter()
        ttft_ms = (t_first - t_start) * 1000 if t_first else None
        decode_s = (t_end - t_first) if t_first else None
        tok_s = token_count / decode_s if decode_s else 0

        results.append({
            "run": i + 1,
            "ttft_ms": round(ttft_ms, 1) if ttft_ms else None,
            "output_tokens": token_count,
            "decode_tok_s": round(tok_s, 1),
            "total_s": round(t_end - t_start, 2),
        })
        print(f"  run {i+1}: TTFT={ttft_ms:.0f}ms  {token_count} tokens  {tok_s:.1f} tok/s",
              file=sys.stderr)

    return results


def summarize(label: str, results: list):
    valid = [r for r in results if r["ttft_ms"] is not None]
    if not valid:
        print(f"\n{label}: no valid results")
        return
    avg_ttft = sum(r["ttft_ms"] for r in valid) / len(valid)
    avg_toks = sum(r["decode_tok_s"] for r in valid) / len(valid)
    avg_total = sum(r["total_s"] for r in valid) / len(valid)
    out_tok = valid[-1]["output_tokens"]
    print(f"\n## {label}")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Runs | {len(valid)} |")
    print(f"| Avg TTFT | {avg_ttft:.0f} ms |")
    print(f"| Avg decode throughput | {avg_toks:.1f} tok/s |")
    print(f"| Avg total time | {avg_total:.1f} s |")
    print(f"| Output tokens (last run) | {out_tok} |")


def main():
    ap = argparse.ArgumentParser(description="Benchmark an OpenAI-compatible inference server")
    ap.add_argument("--url", default="http://127.0.0.1:8081", help="Server base URL")
    ap.add_argument("--model", required=True, help="Model name (--served-model-name)")
    ap.add_argument("--max-tokens", type=int, default=300, help="Max output tokens")
    ap.add_argument("--runs", type=int, default=3, help="Number of benchmark runs")
    ap.add_argument("--prompt", default=None, help="Path to prompt file (default: built-in long prompt)")
    ap.add_argument("--label", default=None, help="Label for output (default: URL)")
    args = ap.parse_args()

    prompt = LONG_PROMPT
    if args.prompt:
        with open(args.prompt) as f:
            prompt = f.read()

    label = args.label or args.url
    prompt_words = len(prompt.split())
    print(f"Benchmarking {label}  model={args.model}  prompt≈{prompt_words} words  "
          f"max_tokens={args.max_tokens}  runs={args.runs}", file=sys.stderr)

    results = benchmark(args.url, args.model, prompt, args.max_tokens, args.runs)
    summarize(label, results)


if __name__ == "__main__":
    main()
