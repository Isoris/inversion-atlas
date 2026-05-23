#!/usr/bin/env python3
"""
join_breakpoints_to_inversions.py  --  STAGE 2: cross-species breakpoints x
hatchery polymorphic inversions.

COHORT DISCIPLINE (critical):
  - breakpoints come from the COMPARATIVE cohort (cross-species synteny / BPATLAS)
  - inversions come from the HATCHERY cohort (226 C. gariepinus, local adaptation)
  These are different objects. A hit means: a hatchery polymorphic inversion sits
  at a region that is ALSO a recurrent breakpoint across catfish species
  (= Class B "inversion on conserved synteny boundary" / Class E "recurrent
  rearrangement hotspot"). It does NOT mean the inversion itself is conserved
  across species. The output wording enforces this.

MATCHABLE set: only Cgar-frame inversion / inverted-transloc intervals are
matchable against within-species breakpoints. LG04, LG13, LG15, LG27.

Inputs:
  --inversions  TSV: inv_id  chrom  start_mb  end_mb   [hatchery intervals]
  --breakpoints TSV: ref_chrom  break_mb  class  query_species  detail
                     (accepts Stage-1 output AND wfmash BPATLAS / CSBP zones)
  --tol-kb      tolerance for "breakpoint near inversion edge" (default 150)

Outputs:
  join_hits.tsv         each (inversion edge, breakpoint) coincidence
  inversion_summary.tsv per inversion: #breakpoints at each edge, #query species,
                        recurrence flag, suggested class (B/E)
"""
import argparse, csv, sys
from collections import defaultdict

def load_inversions(path):
    inv=[]
    with open(path) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            try:
                inv.append({"inv_id":r["inv_id"],"chrom":r["chrom"],
                            "start_mb":float(r["start_mb"]),"end_mb":float(r["end_mb"])})
            except (KeyError,ValueError):
                continue
    return inv

def load_breakpoints(path):
    bp=[]
    with open(path) as fh:
        rdr=csv.DictReader(fh, delimiter="\t")
        for r in rdr:
            chrom=r.get("ref_chrom") or r.get("chrom")
            mb=r.get("break_mb") or r.get("centroid_mb") or r.get("pos_mb")
            if chrom is None or mb is None: continue
            try: mb=float(mb)
            except ValueError: continue
            bp.append({"chrom":chrom,"mb":mb,
                       "class":r.get("class","NA"),
                       "query_species":r.get("query_species") or r.get("query_species","NA"),
                       "detail":r.get("detail","")})
    return bp

def norm_chrom(c):
    # normalize "LG04","4","fClaHyb_african_F1_LG_04" -> "4"
    import re
    m=re.search(r'(\d+)\s*$', c.replace("LG","").replace("_"," "))
    return m.group(1) if m else c

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--inversions",required=True)
    ap.add_argument("--breakpoints",required=True)
    ap.add_argument("--tol-kb",type=float,default=150.0)
    ap.add_argument("--out-hits",default="join_hits.tsv")
    ap.add_argument("--out-summary",default="inversion_summary.tsv")
    args=ap.parse_args()
    tol=args.tol_kb/1000.0  # Mb

    inv=load_inversions(args.inversions)
    bp=load_breakpoints(args.breakpoints)
    print(f"[stage2] {len(inv)} inversions, {len(bp)} breakpoints, tol={args.tol_kb}kb",file=sys.stderr)

    bp_by=defaultdict(list)
    for b in bp: bp_by[norm_chrom(b["chrom"])].append(b)

    hits=[]
    summary=defaultdict(lambda:{"edges_hit":set(),"qsp":set(),"classes":set(),"n":0})
    for iv in inv:
        c=norm_chrom(iv["chrom"])
        for edge_name,edge_mb in (("start",iv["start_mb"]),("end",iv["end_mb"])):
            for b in bp_by.get(c,[]):
                if abs(b["mb"]-edge_mb)<=tol:
                    hits.append({"inv_id":iv["inv_id"],"chrom":iv["chrom"],
                                 "inv_edge":edge_name,"inv_edge_mb":round(edge_mb,3),
                                 "breakpoint_mb":round(b["mb"],3),
                                 "delta_kb":round(abs(b["mb"]-edge_mb)*1000,1),
                                 "bp_class":b["class"],"query_species":b["query_species"],
                                 "detail":b["detail"]})
                    s=summary[iv["inv_id"]]
                    s["edges_hit"].add(edge_name); s["qsp"].add(b["query_species"])
                    s["classes"].add(b["class"]); s["n"]+=1

    with open(args.out_hits,"w",newline="") as fh:
        cols=["inv_id","chrom","inv_edge","inv_edge_mb","breakpoint_mb","delta_kb",
              "bp_class","query_species","detail"]
        w=csv.DictWriter(fh,fieldnames=cols,delimiter="\t"); w.writeheader()
        w.writerows(sorted(hits,key=lambda h:(h["chrom"],h["inv_edge_mb"])))

    with open(args.out_summary,"w",newline="") as fh:
        w=csv.writer(fh,delimiter="\t")
        w.writerow(["inv_id","n_breakpoint_hits","edges_hit","n_query_species",
                    "query_species","bp_classes","suggested_class","interpretation"])
        for iv in inv:
            s=summary.get(iv["inv_id"])
            if not s or s["n"]==0:
                w.writerow([iv["inv_id"],0,"-",0,"-","-","A",
                    "no cross-species breakpoint at either edge: ordinary polymorphic inversion (Class A)"])
                continue
            nqsp=len([q for q in s["qsp"] if q!="NA"])
            recurrent = nqsp>=2 or "interchrom" in s["classes"]
            sclass = "E" if (nqsp>=2 and len(s["classes"])>=2) else ("C" if "interchrom" in s["classes"] else "B")
            interp = ("hatchery inversion edge coincides with a recurrent cross-species breakpoint "
                      f"({nqsp} comparison species" + (", incl. chrom fusion/fission" if "interchrom" in s["classes"] else "")
                      + "): NOT conservation of the polymorphism, but a phylogenetically labile region "
                      "(Class %s)" % sclass)
            w.writerow([iv["inv_id"],s["n"],",".join(sorted(s["edges_hit"])),nqsp,
                        ",".join(sorted(q for q in s["qsp"] if q!="NA")),
                        ",".join(sorted(s["classes"])),sclass,interp])

    print(f"[stage2] {len(hits)} edge-breakpoint hits -> {args.out_hits}",file=sys.stderr)
    print(f"[stage2] summary -> {args.out_summary}",file=sys.stderr)

if __name__=="__main__": main()
