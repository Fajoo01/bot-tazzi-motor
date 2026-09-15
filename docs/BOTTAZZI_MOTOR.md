# Bot-tazzi Motor

Bot-tazzi Motor is a downstream experimental CUDA/SSD-streaming optimization of DwarfStar (`ds4`) for running DeepSeek V4.1 Flash on very small NVIDIA VRAM budgets.

## Credit where it belongs

This work exists because of **DwarfStar / DS4**, created by **Salvatore "antirez" Sanfilippo**, and the work of the DS4, llama.cpp and GGML contributors. The inference engine, model support, quantization formats, kernels and the overwhelming majority of the architecture come from that upstream work. Bot-tazzi Motor is a hardware-specific optimization branch built on top of it, not a claim of independent authorship.

Upstream: https://github.com/antirez/ds4

The original MIT license and copyright notices are retained unchanged.

## Tested target

- NVIDIA GeForce RTX 2070, 8 GiB VRAM (SM75)
- Linux + CUDA
- local NVMe SSD
- DeepSeek V4.1 Flash IQ2/Q2 routed experts
- SSD streaming, single GPU
- 4096 context

Production and benchmark sidecars were isolated: the production server remained on port 19194 while all experimental runs used port 19196.

## Stable result

194-token deterministic prefill, clean build, `prefill_chunk=180`:

| Run | Prefill | Result |
| --- | ---: | --- |
| stable-1 | 39.700 s | PASS / `OK` |
| stable-2 | 38.945 s | PASS / `OK` |
| stable-3 | 38.979 s | PASS / `OK` |

The original long-prompt baseline on this machine was about 103 s. Selected routed-expert traffic fell from roughly 249 GiB to 72.83 GiB in the stable configuration.

Sustained decode validation: 16 generated tokens at **0.87 token/s**, exact deterministic output, watchdog PASS.

`prefill_chunk=184` produced record runs around 38.8-39.3 s but also an OOM, so it is intentionally classified as a marginal/record configuration rather than the stable default.

## Main ideas

1. Remove the accidental CUDA V4.1 prefill cap of 8 rows for single-GPU execution while retaining TP limits where they are actually required.
2. Keep HC work in bounded 8-row slices where needed, but allow wider dense/attention prefill.
3. Route the whole batch once and run routed MoE in **expert windows** rather than repeatedly routing tiny token tiles.
4. Keep the validated V4.1 MMQ IQ2/Q2 kernels; rejected legacy `owned/sorted` expert kernels were numerically divergent on this workload.
5. Deduplicate experts for a window and preserve original router slots for the final sum.
6. Store routed experts in a companion **Bot-tazzi Motor Expert Pack**: one contiguous, 4-KiB-aligned frame per expert containing `gate + up + down`.
7. Use `O_DIRECT` and frame-direct reads into pinned host memory, then H2D from the three frame regions without an extra RAM demux copy.
8. Use a larger stable prefill chunk (`180`) to reduce repeated expert reads between prompt chunks.

## Expert pack

For the tested V4.1 layout, every routed expert frame is exactly 9,953,280 bytes:

- gate: 3,041,280 bytes
- up: 3,041,280 bytes
- down: 3,870,720 bytes

The complete 40 x 384 companion pack is about 142.38 GiB. It does not replace the GGUF; it is an SSD-streaming companion containing only routed-expert payloads in streaming-friendly order.

Build the helper:

```sh
cc -O3 -pthread -o tools/bottazzi-motor/build_expert_pack \
  tools/bottazzi-motor/build_expert_pack.c
```

Then generate the companion using the tested manifest:

```sh
./tools/bottazzi-motor/build_expert_pack \
  /path/to/DeepSeek-V4.1.gguf \
  tools/bottazzi-motor/deepseek-v41-ud-iq2_xxs.manifest \
  /fast/nvme/Bot-tazzi-Motor-v41-experts.pack \
  4
```

The manifest is layout-specific. Do not reuse it for a different GGUF layout without first verifying the tensor offsets and sizes.

## Stable runtime configuration

```sh
export DS4_CUDA_V41_EXPERT_WINDOWS=1
export DS4_CUDA_V41_EXPERT_WINDOW=32
export DS4_CUDA_V41_EXPERT_PACKED_IO=1
export DS4_CUDA_V41_EXPERT_SORTED_IO=1
export DS4_CUDA_V41_EXPERT_FRAME_DIRECT=1
export DS4_CUDA_V41_EXPERT_READ_THREADS=4
export DS4_CUDA_V41_EXPERT_PACK_FILE=/fast/nvme/Bot-tazzi-Motor-v41-experts.pack

./ds4-server -m /path/to/DeepSeek-V4.1.gguf \
  --backend cuda --ssd-streaming --cuda-low-vram-stream --ssd-streaming-cold \
  --ctx 4096 --prefill-chunk 180 --threads 8
```

The exact low-VRAM staging/cache values used by the watchdog were 640 MiB staging, 512 MiB reserve, 6 GiB dense host cache and four expert reader threads.

## Rejected experiments

These are recorded so the same dead ends do not need to be rediscovered:

- scalar MoE fallback: correct but much slower (~161 s in an early 194-token test)
- legacy CUDA `owned/sorted` expert-major path: numerical routing divergence
- window size 48: OOM
- window size 32 vs 24: only a small speed difference; 32 is retained
- buffered parallel pread: dirtied page cache and failed the watchdog
- eight NVMe reader threads: no meaningful gain over four
- zstd on IQ2/Q2 expert frames: less than 1% compression
- large pinned top-32/top-64 cross-chunk expert caches: reduced second-chunk I/O but hurt total latency and caused memory pressure
- async next-window expert prefetch: no useful end-to-end improvement on this machine

## Safety / reproducibility notes

The fast path is opt-in through environment variables and falls back to the ordinary loader when the companion pack is unavailable. The benchmark watchdog checks that production stays alive, port 19194 remains present, the model file is unchanged, and Dirty/Writeback growth stays bounded.

This branch is experimental and tuned to one constrained machine. Results on other GPUs, storage devices or V4.1 GGUF layouts should be revalidated rather than assumed.

## Reproducible sidecar benchmark

Local benchmark output is intentionally kept out of Git. Use the public helper instead:

```sh
python3 tools/bottazzi-motor/benchmark_sidecar.py stable-prefill \
  --model /path/to/DeepSeek-V4.1-Flash-Q2.gguf \
  --pack /fast/nvme/Bot-tazzi-Motor-v41-experts.pack \
  --mode prefill --prefill-chunk 180
```

For sustained decode validation, use `--mode decode --tokens 16`. The helper launches only the isolated sidecar, requires the production listener on port 19194 by default, records request/response/server log under `.bottazzi-validation/`, verifies that the model metadata is unchanged, and removes the sidecar when the run ends. Set `--production-port 0` only on machines with no production service.

## Experimental predictive route prefetch

Bot-tazzi Motor can optionally learn cross-layer MoE routing transitions from diagnostic route traces and prefetch likely future expert frames. The predictor never changes router output, expert selection, logits, or model weights: a miss falls back to the normal O_DIRECT loader.

Enable route tracing only for isolated diagnostic runs:

```sh
export DS4_CUDA_V41_ROUTE_TRACE=/tmp/route.csv
```

Train a horizon-2 transition model from several independent traces:

```sh
python3 tools/bottazzi-motor/train_route_predictor.py \
  --route trace-a.csv --route trace-b.csv --route trace-c.csv \
  --horizon 2 --output route-transition-h2.bin
```

The trainer intentionally does not include or publish the private prompts used to produce local traces. NumPy is required only for training, not for inference.
Run inference with the predictor as an opt-in experiment:

```sh
export DS4_CUDA_V41_ROUTE_PREFETCH=1
export DS4_CUDA_V41_ROUTE_PREDICTOR=/path/to/route-transition-h2.bin
export DS4_CUDA_V41_ROUTE_PREFETCH_BUDGET=16
```

On the tested RTX 2070 while production remained resident on the same GPU, a 146-token Judge-style OOD prompt at `prefill_chunk=96` gave two clean baseline prefills of 43.481 s and 43.324 s, versus 42.932 s and 42.883 s with horizon-2/B16 prefetch: about 1.14% lower mean prefill latency. The rolling cache used about 303.75 MiB pinned host memory and served about 4.6 GiB of expert frames per run.

Larger budgets were not safe defaults on this constrained shared-GPU setup: B20 (~379.69 MiB rolling cache) and cleaned B24 (~455.62 MiB) could trigger CUDA OOM at the normal 512 MiB reserve. Increasing the reserve to 640-768 MiB restored stability but removed nearly all measured speedup by shrinking the persistent model cache. Therefore predictive prefetch remains experimental and disabled by default.

For Judge/process workloads, benchmark with an exact OpenAI-compatible request rather than the built-in synthetic prompt:

```sh
python3 tools/bottazzi-motor/benchmark_sidecar.py judge-ab \
  --model /path/to/model.gguf --pack /fast/nvme/experts.pack \
  --request-json judge-request.json --prefill-chunk 96 \
  --stage-mb 640 --reserve-mb 512 --expert-window 32
```
