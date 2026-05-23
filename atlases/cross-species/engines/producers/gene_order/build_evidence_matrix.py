#!/usr/bin/env python3
"""
build_evidence_matrix.py -- the CONSOLIDATION step, done as evidence accumulation.

Philosophy (per Quentin): run ALL methods, accumulate ALL breakpoints, attach
EVERY method's verdict as columns. Do NOT pre-filter by threshold. The
'consolidated very large inversions' fall out as the rows lit up across all
methods. Same treatment as the styled supplementary breakpoint tables.

Takes any number of breakpoint sources (each a TSV with chrom + Mb position),
bins them onto a common coordinate grid (hybrid frame), and builds a matrix:

  ref_chrom  bin_mb  | gene_order  wfmash_inv  wfmash_interchrom  mashmap  macrosyntR |
                       n_methods  methods_hit  max_span_mb  event_classes  consensus_rank

consensus_rank just orders rows by how many independent methods agree (and span),
so the top of the table IS the consolidated large-inversion set -- no threshold,
the evidence ranks itself.

Each source is declared as  NAME:PATH  (NAME becomes the column).
Columns auto-detected: chrom from {ref_chrom,chrom,query_chrom}; Mb from
{break_mb,centroid_mb,pos_mb,Pos(/1e6)}; optional span/class columns folded in.
"""
import argparse, csv, sys, re
from collections import defaultdict

def norm_chrom(c):
    if c is None: return None
    c=str(c)
    # prefer an explicit LG<number> token (e.g. C_gar_CM044234.1_LG03 -> 03)
    m=re.search(r'LG[_]?(\d+)', c)
    if m: return str(int(m.group(1)))
    # else trailing number
    m=re.search(r'(\d+)\s*$', c.replace("_"," ").strip())
    return str(int(m.group(1))) if m else c

def read_source(path):
    rows=[]
    with open(path, errors="ignore") as fh:
        rdr=csv.DictReader(fh, delimiter="\t")
        cols=rdr.fieldnames or []
        def pick(*c):
            for x in c:
                if x in cols: return x
            return None
        cc=pick("ref_chrom","chrom","Chr","query_chrom","seqnames","qchrom")
        cm=pick("break_mb","centroid_mb","pos_mb","Mb")
        cpos=pick("Pos","pos","position","query_pos","qpos","bp_pos")  # bp -> /1e6
        cspan=pick("span_mb","len_mb","block_mb","length_kb")
        ccls=pick("class","event","bp_class","event_class","event_type_refined")
        cconf=pick("confidence","conf")
        ckind=pick("pair_kind","comparison","pair_id")
        for r in rdr:
            chrom=norm_chrom(r.get(cc)) if cc else None
            if cm and r.get(cm):
                try: mb=float(r[cm])
                except ValueError: continue
            elif cpos and r.get(cpos):
                try: mb=float(r[cpos])/1e6
                except ValueError: continue
            else: continue
            span=None
            if cspan and r.get(cspan):
                try:
                    span=float(r[cspan]); 
                    if cspan=="length_kb": span/=1000.0
                except ValueError: span=None
            cls=r.get(ccls,"") if ccls else ""
            conf=r.get(cconf,"") if cconf else ""
            if chrom is None: continue
            # skip the NONCOLLINEAR noise class (kept out of consensus, like the supp tables)
            if cls and cls.strip().upper()=="NONCOLLINEAR": continue
            rows.append((chrom,mb,span,cls,conf))
    return rows

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",action="append",required=True,
                    help="NAME:PATH  (repeatable). NAME becomes a method column.")
    ap.add_argument("--bin-mb",type=float,default=1.0,help="coordinate bin width")
    ap.add_argument("--out",required=True)
    args=ap.parse_args()

    sources={}
    for s in args.source:
        name,path=s.split(":",1)
        sources[name]=read_source(path)
        print(f"  {name:18} {len(sources[name]):5} breakpoints  ({path})",file=sys.stderr)

    bw=args.bin_mb
    grid=defaultdict(lambda: defaultdict(int))   # (chrom,bin) -> method -> count
    spans=defaultdict(float); classes=defaultdict(set); conf=defaultdict(lambda:defaultdict(int))
    for name,rows in sources.items():
        for rec in rows:
            chrom,mb,span,cls = rec[0],rec[1],rec[2],rec[3]
            cf = rec[4] if len(rec)>4 else ""
            b=round(mb/bw)*bw
            key=(chrom,b)
            grid[key][name]+=1
            if span: spans[key]=max(spans[key],span)
            if cls: classes[key].add(cls)
            if cf: conf[key][cf]+=1

    methods=list(sources.keys())
    out=[]
    for (chrom,b),mc in grid.items():
        hit=[m for m in methods if mc.get(m,0)>0]
        row={"ref_chrom":chrom,"bin_mb":round(b,3)}
        for m in methods: row[m]=mc.get(m,0)
        row["n_methods"]=len(hit)
        row["methods_hit"]=",".join(hit)
        row["max_span_mb"]=round(spans.get((chrom,b),0),3)
        row["event_classes"]=",".join(sorted(classes.get((chrom,b),set())))
        cf=conf.get((chrom,b),{})
        row["confidence"]=("high" if cf.get("high",0)>0 else ("low" if cf.get("low",0)>0 else ""))
        out.append(row)

    # consensus rank: more methods first, then larger span. No threshold filter.
    out.sort(key=lambda r:(-r["n_methods"], -r["max_span_mb"], r["ref_chrom"], r["bin_mb"]))
    for i,r in enumerate(out,1): r["consensus_rank"]=i

    cols=["consensus_rank","ref_chrom","bin_mb"]+methods+\
         ["n_methods","methods_hit","max_span_mb","event_classes","confidence"]
    with open(args.out,"w",newline="") as fh:
        w=csv.DictWriter(fh,fieldnames=cols,delimiter="\t"); w.writeheader(); w.writerows(out)
    multi=sum(1 for r in out if r["n_methods"]>=2)
    print(f"[matrix] {len(out)} bins, {multi} multi-method (>=2) -> {args.out}",file=sys.stderr)
    print(f"[matrix] top rows = consolidated large-inversion candidates (no threshold; evidence-ranked)",file=sys.stderr)

if __name__=="__main__": main()
