#!/usr/bin/env python3
"""Train a cross-layer expert-transition predictor from DS4 route traces."""
import argparse
from pathlib import Path
import struct

try:
    import numpy as np
except ImportError as exc:
    raise SystemExit("train_route_predictor.py requires NumPy") from exc

MAGIC = b"BTMTRN1\0"


def load_trace(path: Path, layers: int):
    chunks, rows = [], {}
    last_layer = None
    with path.open() as f:
        for line in f:
            layer, row, _slot, expert = map(int, line.split(','))
            if last_layer is not None and layer == 0 and last_layer != 0 and rows:
                if len(rows) == layers:
                    chunks.append(rows)
                rows = {}
            rows.setdefault(layer, {}).setdefault(row, []).append(expert)
            last_layer = layer
    if len(rows) == layers:
        chunks.append(rows)
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--route", action="append", required=True, type=Path,
                    help="route.csv trace; repeat for multiple training prompts")
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--horizon", type=int, default=2)
    ap.add_argument("--layers", type=int, default=40)
    ap.add_argument("--experts", type=int, default=384)
    ap.add_argument("--smoothing", type=float, default=0.01)
    a = ap.parse_args()
    if a.horizon < 1 or a.horizon >= a.layers:
        ap.error("--horizon must be between 1 and layers-1")
    if a.layers < 2 or a.experts < 1 or a.smoothing <= 0:
        ap.error("invalid layers/experts/smoothing")
    for path in a.route:
        if not path.is_file():
            ap.error(f"missing route trace: {path}")

    traces = [load_trace(path, a.layers) for path in a.route]
    n_layers = a.layers - a.horizon
    a.output.parent.mkdir(parents=True, exist_ok=True)
    with a.output.open("wb") as out:
        out.write(MAGIC)
        out.write(struct.pack("<4I", 1, a.horizon, n_layers, a.experts))
        for layer in range(n_layers):
            matrix = np.full((a.experts, a.experts), a.smoothing, dtype=np.float32)
            observations = 0
            for trace in traces:
                for chunk in trace:
                    src = chunk.get(layer)
                    dst = chunk.get(layer + a.horizon)
                    if not src or not dst:
                        continue
                    for row in range(min(len(src), len(dst))):
                        xs = [x for x in src[row] if 0 <= x < a.experts]
                        ys = [y for y in dst[row] if 0 <= y < a.experts]
                        for x in xs:
                            for y in ys:
                                matrix[x, y] += 1.0
                                observations += 1
            matrix /= matrix.sum(axis=1, keepdims=True)
            out.write(matrix.astype("<f4", copy=False).tobytes())
            print(f"layer={layer} observations={observations}")

    print(f"wrote {a.output} ({a.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
