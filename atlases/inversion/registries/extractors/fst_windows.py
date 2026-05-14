"""Extractors for the inversion-atlas action pipeline.

An extractor takes a dict of raw output paths (as returned by the
runner) plus a small params dict, and returns a layer payload — a Python
dict that validates against schemas/schema_out/<schema_version>.schema.json.

This module's `extract` converts the JSON response from
/api/popstats/groupwise into an fst_windows_v1 payload: one row per
window with start_bp, end_bp, value, n_sites, plus a summary block.

Per atlas-core/toolkit_registries/PIPELINE_FLOW.md the extractor does
NOT wrap the payload in an envelope — that's the dispatcher's job.
"""
from __future__ import annotations

import json
import math
import pathlib
from typing import Any, Dict, List, Optional


def _coerce_int(v: Any) -> Optional[int]:
    if v is None: return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _coerce_float(v: Any) -> Optional[float]:
    if v is None: return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    """Parse the popstats JSON into an fst_windows_v1 payload.

    raw_outputs:
        { "popstats_json": "<path>" } — written by runners.popstats.run_fst.
    params:
        { "value_col": "fst" }       — which metric column to read as the value.

    Returns the payload dict to be wrapped in a layer envelope.
    """
    src = pathlib.Path(raw_outputs["popstats_json"])
    doc = json.loads(src.read_text(encoding="utf-8"))

    rows: List[Dict[str, Any]] = doc.get("windows") or []
    value_col = params.get("value_col", "fst")

    windows: List[Dict[str, Any]] = []
    values: List[float] = []
    for r in rows:
        # The popstats endpoint emits columns named per the engine's TSV
        # ('start', 'end', 'n_sites', 'fst', ...). Accept the _bp variants
        # too so a future schema rename doesn't silently break extraction.
        start_bp = _coerce_int(r.get("start_bp", r.get("start")))
        end_bp   = _coerce_int(r.get("end_bp",   r.get("end")))
        if start_bp is None or end_bp is None:
            continue
        val      = _coerce_float(r.get(value_col))
        n_sites  = _coerce_int(r.get("n_sites"))
        windows.append({
            "start_bp": start_bp,
            "end_bp":   end_bp,
            "fst":      val,
            "n_sites":  n_sites,
        })
        if val is not None:
            values.append(val)

    summary: Dict[str, Any] = {
        "n_windows": len(windows),
        "mean_fst":  (sum(values) / len(values)) if values else None,
        "max_fst":   max(values) if values else None,
    }
    return {"windows": windows, "summary": summary}
