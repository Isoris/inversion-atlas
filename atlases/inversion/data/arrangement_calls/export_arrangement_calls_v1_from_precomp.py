#!/usr/bin/env python3
"""Derive an arrangement_calls_v1.json export (+ sample_map.json) for a
chromosome from the inversion atlas's precomp, until the band-tracking step
emits it natively.

Reproduces the atlas per-candidate karyotype call: aggregate sign-aligned
mean PC1 across a candidate envelope's windows, K-means (K=3), order clusters
by centre PC1 (lo->hi = arrangement 0/1/2 = HOM_REF/HET/HOM_INV, the
assignKaryotypes convention). The per-sample arrangement ids are written in
PRECOMP SAMPLE ORDER so they line up with sample_map.json.

VALIDATION: when the matching arrangement_calls consensus JSON
(CLEAN_envs_*.json) carries cluster_diagnostics, the derived n_per_group is
checked against it and the script refuses to emit on mismatch — so the export
matches what the atlas itself computed.

Output schema (consumed by relatedness-atlas .../runners/build_inversion_karyotypes.py):
    arrangement_calls_v1.json : { chrom, n_samples,
        candidates: { <cand_id>: { candidate_id, start_bp, end_bp,
            n_arrangements, arrangement_per_sample[], arrangement_sizes[] } } }
    sample_map.json           : [ { cga, ind }, ... ]  (precomp order)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def sign_aligned_mean_pc1(windows, s0, e0, n):
    acc = np.zeros(n)
    ref = None
    cnt = 0
    for w in range(s0, e0 + 1):
        pc1 = np.asarray(windows[w]["pc1"], dtype=float)
        sign = 1.0 if ref is None else (1.0 if float(np.dot(ref, pc1)) >= 0 else -1.0)
        acc += sign * pc1
        cnt += 1
        ref = acc / cnt
    return acc / max(1, cnt)


def kmeans_1d(x, k=3, iters=200):
    c = np.quantile(x, np.linspace(0.17, 0.83, k))
    for _ in range(iters):
        lab = np.argmin(np.abs(x[:, None] - c[None, :]), axis=1)
        nc = np.array([x[lab == j].mean() if np.any(lab == j) else c[j] for j in range(k)])
        if np.allclose(nc, c):
            break
        c = nc
    return lab, c


def derive(precomp, env_id):
    envs = {e["candidate_id"]: e for e in precomp["l2_envelopes"]}
    e = envs[env_id]
    s0, e0 = e["start_w"] - 1, e["end_w"] - 1
    n = precomp["n_samples"]
    xs = sign_aligned_mean_pc1(precomp["windows"], s0, e0, n)
    lab, c = kmeans_1d(xs, 3)
    order = np.argsort(c)
    remap = {int(old): new for new, old in enumerate(order)}
    arr = [int(remap[int(l)]) for l in lab]
    sizes = [int(sum(1 for a in arr if a == k)) for k in range(3)]
    return arr, sizes, e


def validate(consensus_path, sizes):
    if not consensus_path or not Path(consensus_path).exists():
        return None
    d = json.loads(Path(consensus_path).read_text())
    diags = d.get("cluster_diagnostics") or []
    if not diags:
        return None
    target = diags[0].get("n_per_group")
    return target == sizes, target


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--precomp", required=True, type=Path)
    ap.add_argument("--candidate", required=True, action="append",
                    help="cand_id=envelope_id (repeatable)")
    ap.add_argument("--validate", type=Path, default=None,
                    help="CLEAN_envs_*.json consensus to check n_per_group against")
    ap.add_argument("--out-arrangements", required=True, type=Path)
    ap.add_argument("--out-samples", required=True, type=Path)
    args = ap.parse_args()

    precomp = json.loads(args.precomp.read_text())
    candidates = {}
    for spec in args.candidate:
        cid, env_id = spec.split("=", 1)
        arr, sizes, e = derive(precomp, env_id)
        print(f"{cid} <- {env_id}: arrangement_sizes(0/1/2)={sizes}")
        v = validate(args.validate, sizes)
        if v is not None:
            ok, target = v
            print(f"  validate vs {target}: {'OK' if ok else 'MISMATCH'}")
            if not ok:
                print("  ! refusing to emit — derived sizes differ from the atlas's "
                      "own cluster_diagnostics", file=sys.stderr)
                return 3
        candidates[cid] = {
            "candidate_id": cid,
            "start_bp": e["start_bp"],
            "end_bp": e["end_bp"],
            "n_arrangements": 3,
            "arrangement_per_sample": arr,
            "arrangement_sizes": sizes,
        }

    doc = {
        "chrom": precomp.get("chrom", "?"),
        "n_samples": precomp["n_samples"],
        "_derived": "export_arrangement_calls_v1_from_precomp.py (K=3 on sign-aligned "
                    "mean PC1; validated vs CLEAN_envs consensus). Replace when the "
                    "band-tracking step emits arrangement_calls_v1.json natively.",
        "candidates": candidates,
    }
    args.out_arrangements.parent.mkdir(parents=True, exist_ok=True)
    args.out_arrangements.write_text(json.dumps(doc, indent=1))
    print(f"  wrote {args.out_arrangements}")

    sample_map = [{"cga": s.get("cga"), "ind": s.get("ind")} for s in precomp["samples"]]
    args.out_samples.parent.mkdir(parents=True, exist_ok=True)
    args.out_samples.write_text(json.dumps(sample_map, indent=1))
    print(f"  wrote {args.out_samples}  ({len(sample_map)} samples, precomp order)")
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
