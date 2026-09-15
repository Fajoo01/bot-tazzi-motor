#!/usr/bin/env python3
"""Reproducible Bot-tazzi Motor sidecar benchmark."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = (
    "This is a deterministic context paragraph used only to validate long-prompt inference. "
    "It describes a small library with books, tables, windows, lamps, notebooks, pencils, maps, "
    "clocks, plants, chairs, shelves, and a quiet reading room. Nothing in this paragraph changes "
    "the task. "
)
PROMPT_OK = BASE * 3 + (
    "After reading all of the context above, answer with exactly the single word OK and nothing else."
)
PROMPT_DECODE = BASE * 3 + (
    "After reading all of the context above, write the sequence: one two three four five six seven "
    "eight nine ten eleven twelve thirteen fourteen fifteen sixteen. Do not stop before sixteen."
)

def sh(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)

def listening(port):
    return bool(sh("ss", "-H", "-ltn", f"sport = :{port}").strip())

def model_stat(path):
    s = path.stat()
    return (s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def wait_listener(port, proc, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("sidecar exited before opening its port")
        if listening(port):
            return
        time.sleep(1)
    raise RuntimeError("sidecar startup timeout")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("label")
    ap.add_argument("--model", required=True, type=Path)
    ap.add_argument("--pack", required=True, type=Path)
    ap.add_argument("--mode", choices=("prefill", "decode"), default="prefill")
    ap.add_argument("--tokens", type=int)
    ap.add_argument("--request-json", type=Path,
                    help="use an OpenAI-compatible request JSON instead of the built-in prompt")
    ap.add_argument("--prefill-chunk", type=int, default=180)
    ap.add_argument("--ctx", type=int, default=4096)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--stage-mb", type=int, default=640)
    ap.add_argument("--reserve-mb", type=int, default=512)
    ap.add_argument("--expert-window", type=int, default=32)
    ap.add_argument("--port", type=int, default=19196)
    ap.add_argument("--production-port", type=int, default=19194,
                    help="set to 0 to disable the production-listener guard")
    ap.add_argument("--output-root", type=Path,
                    default=ROOT / ".bottazzi-validation")
    a = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", a.label):
        ap.error("label may contain only letters, digits, _ and -")
    if not a.model.is_file() or not a.pack.is_file():
        ap.error("--model and --pack must exist")
    if listening(a.port):
        raise RuntimeError(f"sidecar port {a.port} is already busy")
    if a.production_port and not listening(a.production_port):
        raise RuntimeError(f"production port {a.production_port} is absent")

    out = a.output_root / a.label
    out.mkdir(parents=True, exist_ok=False)
    before = model_stat(a.model)
    max_tokens = a.tokens if a.tokens is not None else (1 if a.mode == "prefill" else 16)
    if a.request_json:
        request = json.loads(a.request_json.read_text())
        if not isinstance(request, dict) or not isinstance(request.get("messages"), list):
            ap.error("--request-json must contain an object with a messages array")
        request["stream"] = False
        request.setdefault("think", False)
        request.setdefault("temperature", 0)
        request["max_tokens"] = max_tokens
        request.setdefault("model", "deepseek-v4.1-flash")
    else:
        prompt = PROMPT_OK if a.mode == "prefill" else PROMPT_DECODE
        request = {"model": "deepseek-v4.1-flash",
                   "messages": [{"role": "user", "content": prompt}],
                   "stream": False, "think": False,
                   "max_tokens": max_tokens, "temperature": 0}
    (out / "request.json").write_text(json.dumps(request, indent=2))

    env = dict(os.environ)
    env.update({
        "DS4_LOCK_FILE": str(out / "sidecar.lock"),
        "DS4_CUDA_LOW_VRAM_STAGE_MB": str(a.stage_mb),
        "DS4_CUDA_LOW_VRAM_RESERVE_MB": str(a.reserve_mb),
        "DS4_CUDA_V41_SMALL_PREFILL": "1",
        "DS4_CUDA_LOW_VRAM_DENSE_READAHEAD": "1",
        "DS4_CUDA_LOW_VRAM_HOST_CACHE_GB": "6",
        "DS4_CUDA_LOW_VRAM_HOST_CACHE_PINNED": "1",
        "DS4_CUDA_HOST_EXPERT_CHUNK_CACHE_GB": "16",
        "DS4_CUDA_HOST_EXPERT_CHUNK_CACHE_PINNED": "1",
        "DS4_CUDA_V41_EXPERT_WINDOWS": "1",
        "DS4_CUDA_V41_EXPERT_WINDOW": str(a.expert_window),
        "DS4_CUDA_V41_EXPERT_PACKED_IO": "1",
        "DS4_CUDA_V41_EXPERT_SORTED_IO": "1",
        "DS4_CUDA_V41_EXPERT_FRAME_DIRECT": "1",
        "DS4_CUDA_V41_EXPERT_READ_THREADS": "4",
        "DS4_CUDA_V41_EXPERT_PACK_FILE": str(a.pack),
    })
    cmd = [str(ROOT / "ds4-server"), "-m", str(a.model), "--backend", "cuda",
           "--ssd-streaming", "--cuda-low-vram-stream", "--ssd-streaming-cold",
           "--ctx", str(a.ctx), "--prefill-chunk", str(a.prefill_chunk),
           "--threads", str(a.threads), "--tokens", "32",
           "--host", "127.0.0.1", "--port", str(a.port)]

    proc = None
    started = time.monotonic()
    try:
        with open(out / "server.log", "w") as log:
            proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=log,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            wait_listener(a.port, proc)
            body = json.dumps(request).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{a.port}/v1/chat/completions", body,
                {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=480) as resp:
                response = resp.read().decode()
            (out / "response.json").write_text(response)
    finally:
        if proc and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=25)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()

    elapsed = time.monotonic() - started
    if model_stat(a.model) != before:
        raise RuntimeError("model metadata changed during benchmark")
    if a.production_port and not listening(a.production_port):
        raise RuntimeError("production listener disappeared during benchmark")
    if listening(a.port):
        raise RuntimeError("sidecar port remained open after benchmark")
    print(f"BOTTAZZI_BENCH_PASS mode={a.mode} elapsed={elapsed:.3f}s out={out}")

if __name__ == "__main__":
    main()
