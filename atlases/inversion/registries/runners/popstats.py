"""Runners for the inversion-atlas action pipeline.

A runner takes a validated action manifest plus a server client and
produces raw output files on disk. It returns a dict of {name: path}
that the matching extractor then parses.

This module's `run_fst` wraps atlas-core's existing /api/popstats/groupwise
endpoint (which runs region_popstats / Engine F). The endpoint returns a
parsed JSON object; we persist it so the extractor has a stable raw
artifact to re-parse without re-running the engine.

Per atlas-core/toolkit_registries/PIPELINE_FLOW.md the runner does NOT
build envelopes or write to the layer registry — that's the dispatcher
+ server's job.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any, Dict


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    """Resolve where this runner writes its raw output. Prefers the
    project root (ATLAS_PROJECT_ROOT env, set by atlas_server.py) so
    raw_results/ lives under the workspace; falls back to CWD."""
    root_env = os.environ.get("ATLAS_PROJECT_ROOT")
    root = pathlib.Path(root_env) if root_env else pathlib.Path.cwd()
    return root / "raw_results" / "popstats" / manifest["action_id"]


def run_fst(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    """Call /api/popstats/groupwise with the manifest's target+params
    and write the response JSON to raw_results/popstats/<action_id>/.

    Returns:
        { "popstats_json": "<absolute path to the popstats response>" }

    Raises:
        Any exception from the HTTP call propagates up to the dispatcher,
        which surfaces it through the action log as status=error.
    """
    target = manifest.get("target") or {}
    params = manifest.get("params") or {}

    body: Dict[str, Any] = {
        "chrom":   target["chrom"],
        "groups":  target["groups"],
        "metrics": [params.get("stat", "fst")],
        "win_bp":  int(params.get("win_bp", 50000)),
        "step_bp": int(params.get("step_bp", 10000)),
    }
    if "start_bp" in target and "end_bp" in target:
        body["region"] = {
            "start_bp": int(target["start_bp"]),
            "end_bp":   int(target["end_bp"]),
        }

    resp = client.post("/api/popstats/groupwise", body)

    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "popstats_groupwise.json"
    out_path.write_text(json.dumps(resp, indent=2), encoding="utf-8")
    return {"popstats_json": str(out_path)}
