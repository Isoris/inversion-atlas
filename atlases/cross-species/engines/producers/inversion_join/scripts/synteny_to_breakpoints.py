#!/usr/bin/env python3
"""
synteny_to_breakpoints.py  --  STAGE 1: macrosyntR synteny blocks -> breakpoints.

macrosyntR's compute_macrosynteny() / its block output describes conserved
blocks between a focal genome and each comparison species. The EDGES of those
blocks (where a block on the focal chrom ends and the next block belongs to a
different comparison chrom, or flips orientation) are the cross-species
BREAKPOINTS.

This emits, on the FOCAL (hybrid) frame:
    ref_chrom  break_mb  class            query_species  detail
    LG04       16.45     interchrom       C_fuscus       blockA->blockB chrom switch
    LG13        5.15     orientation      C_apus         strand flip + -> -

class:
    interchrom    = focal region maps to a DIFFERENT comparison chrom across the edge
    orientation   = same comparison chrom but strand/sign flips  (inversion-like; weak w/o strand)
    block_gap     = large coordinate gap between consecutive blocks on focal chrom

>>> EDIT parse_macrosyntr_table() to match YOUR column names once you paste the head. <<<
The rest (edge detection, output) is generic and tested.
"""
import argparse, csv, sys
from pathlib import Path
from collections import defaultdict

# ---------------------------------------------------------------------------
# EDIT THIS to match your macrosyntR block table columns.
# macrosyntR compute_macrosynteny() typically yields a data frame with:
#   org.x, org.y, chr.x, chr.y, n_orthologs, p.value, ...
# but YOUR exported table may differ. Map your columns to these fields:
#   focal_chrom, focal_start_bp, focal_end_bp, query_species, query_chrom, sign/strand
# If your table is block-level WITHOUT per-block focal coords, see the
# "ortholog-level" fallback below.
# ---------------------------------------------------------------------------
def parse_macrosyntr_table(path, focal_label):
    """Return list of blocks: dict(focal_chrom, focal_start, focal_end,
       query_species, query_chrom, sign). FILL IN column names for your file."""
    rows = []
    with open(path, errors="ignore") as fh:
        rdr = csv.DictReader(fh, delimiter="\t")
        cols = rdr.fieldnames or []
        # --- attempt auto-detection of common macrosyntR exports ---
        def pick(*cands):
            for c in cands:
                if c in cols: return c
            return None
        c_fchr = pick("focal_chrom","chr.x","chrom.x","ref_chrom","seqnames.x")
        c_fs   = pick("focal_start","start.x","start_x","ref_start")
        c_fe   = pick("focal_end","end.x","end_x","ref_end")
        c_qsp  = pick("query_species","org.y","sp.y","species.y")
        c_qchr = pick("query_chrom","chr.y","chrom.y","seqnames.y")
        c_sign = pick("sign","strand","orientation")
        if not (c_fchr and c_fs and c_fe and c_qchr):
            sys.exit("Could not auto-detect columns. Columns present: %s\n"
                     "Edit parse_macrosyntr_table() to map them." % cols)
        for r in rdr:
            try:
                fs, fe = int(float(r[c_fs])), int(float(r[c_fe]))
            except (ValueError, KeyError):
                continue
            rows.append({
                "focal_chrom": r[c_fchr],
                "focal_start": min(fs,fe), "focal_end": max(fs,fe),
                "query_species": r.get(c_qsp, "NA") if c_qsp else "NA",
                "query_chrom": r[c_qchr],
                "sign": r.get(c_sign, ".") if c_sign else ".",
            })
    return rows

def blocks_to_breakpoints(blocks):
    """Find edges between consecutive blocks on the same focal chrom (per query sp)."""
    bps = []
    by = defaultdict(list)
    for b in blocks:
        by[(b["query_species"], b["focal_chrom"])].append(b)
    for (qsp, fchr), bl in by.items():
        bl.sort(key=lambda x: x["focal_start"])
        for a, c in zip(bl, bl[1:]):
            edge_mb = round((a["focal_end"] + c["focal_start"]) / 2 / 1e6, 3)
            if a["query_chrom"] != c["query_chrom"]:
                bps.append((fchr, edge_mb, "interchrom", qsp,
                            f"{a['query_chrom']}->{c['query_chrom']}"))
            elif a["sign"] != c["sign"] and a["sign"] != "." :
                bps.append((fchr, edge_mb, "orientation", qsp,
                            f"sign {a['sign']}->{c['sign']}"))
            else:
                gap = c["focal_start"] - a["focal_end"]
                if gap > 2_000_000:
                    bps.append((fchr, edge_mb, "block_gap", qsp,
                                f"gap {round(gap/1e6,2)}Mb"))
    return bps

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks", required=True, type=Path, help="macrosyntR block table (TSV)")
    ap.add_argument("--focal-label", default="fClaHyb_Gar")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    blocks = parse_macrosyntr_table(args.blocks, args.focal_label)
    print(f"[stage1] {len(blocks)} synteny blocks", file=sys.stderr)
    bps = blocks_to_breakpoints(blocks)
    with args.out.open("w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["ref_chrom","break_mb","class","query_species","detail"])
        w.writerows(sorted(bps))
    print(f"[stage1] {len(bps)} breakpoints -> {args.out}", file=sys.stderr)

if __name__ == "__main__":
    main()
