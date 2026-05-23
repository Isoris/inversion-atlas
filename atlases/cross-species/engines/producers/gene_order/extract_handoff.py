#!/usr/bin/env python3
"""extract_handoff.py -- turn multi-method evidence-matrix bins into inversion
INTERVALS for the POD engines. Carries COORDINATES across the cohort boundary,
never claims. Pairs consecutive multi-method bins on the same chrom into
candidate inversion intervals (start edge .. end edge).

Input : evidence_matrix.tsv (from build_evidence_matrix.py)
Output: consolidated_large_inversions.tsv  inv_id chrom start_mb end_mb n_methods_start n_methods_end evidence
        (this is the HANDOFF file -> region_popstats / POD_candidate_variant)
"""
import argparse, csv, sys
from collections import defaultdict

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--matrix",required=True)
    ap.add_argument("--min-methods",type=int,default=2,
                    help="a bin is an inversion-edge candidate if >= this many methods agree (default 2)")
    ap.add_argument("--out",required=True)
    args=ap.parse_args()

    by=defaultdict(list)
    with open(args.matrix) as fh:
        for r in csv.DictReader(fh,delimiter="\t"):
            if int(r["n_methods"])>=args.min_methods:
                by[r["ref_chrom"]].append(r)
    out=[]
    for chrom,rows in by.items():
        rows.sort(key=lambda r:float(r["bin_mb"]))
        # pair consecutive edges into intervals; lone edges reported as point candidates
        i=0
        while i < len(rows):
            if i+1 < len(rows):
                a,b=rows[i],rows[i+1]
                out.append({"inv_id":f"INV_{chrom}_{a['bin_mb']}_{b['bin_mb']}",
                    "chrom":f"LG{chrom}","start_mb":a["bin_mb"],"end_mb":b["bin_mb"],
                    "n_methods_start":a["n_methods"],"n_methods_end":b["n_methods"],
                    "evidence":f"{a['methods_hit']} | {b['methods_hit']}",
                    "span_mb":round(float(b["bin_mb"])-float(a["bin_mb"]),3)})
                i+=2
            else:
                a=rows[i]
                out.append({"inv_id":f"INV_{chrom}_{a['bin_mb']}_pt",
                    "chrom":f"LG{chrom}","start_mb":a["bin_mb"],"end_mb":a["bin_mb"],
                    "n_methods_start":a["n_methods"],"n_methods_end":0,
                    "evidence":a["methods_hit"],"span_mb":0})
                i+=1
    cols=["inv_id","chrom","start_mb","end_mb","span_mb","n_methods_start","n_methods_end","evidence"]
    with open(args.out,"w",newline="") as fh:
        w=csv.DictWriter(fh,fieldnames=cols,delimiter="\t"); w.writeheader()
        w.writerows(sorted(out,key=lambda r:(-float(r["span_mb"]),r["chrom"])))
    print(f"[handoff] {len(out)} candidate intervals -> {args.out}",file=sys.stderr)
    print(f"[handoff] COORDINATES ONLY. POD is tested fresh in the hatchery cohort.",file=sys.stderr)

if __name__=="__main__": main()
