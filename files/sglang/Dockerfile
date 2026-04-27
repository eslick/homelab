ARG BASE_IMAGE=lmsysorg/sglang:latest
FROM ${BASE_IMAGE}

# Install precompiled CUDA extensions to replace the broken Triton JIT path
# for causal_conv1d (used by GatedDeltaNet linear attention layers in Qwen3.6).
# SGLang auto-detects these packages and skips the Triton fallback when present.
RUN pip install --no-cache-dir \
    "causal-conv1d>=1.4.0" \
    "mamba-ssm>=2.2.4"
