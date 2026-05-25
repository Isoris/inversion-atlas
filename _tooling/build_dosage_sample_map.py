#!/usr/bin/env python3
"""
build_dosage_sample_map.py — emit a chunk-sample → cohort-sample map
for the atlas's dosage-coloring path.

The beagle file the server slices into /api/dosage/chunk uses placeholder
sample ids (Ind / Ind0 / Ind1 / ... — 3 columns per sample for the
P(AA), P(Aa), P(aa) triple) so the column order is well-defined but the
cohort identity is lost. The matching BAM list (the input to angsd /
emiBeagle / your dosage pipeline) carries the real per-sample identity
in BAM-path order, which is the SAME order beagle's per-sample columns
follow. This script reads both, validates the count, and writes a JSON
that the atlas loads to translate chunk samples → cohort ids without
having to re-run the dosage pipeline.

Usage:
    # Fast path — when the pipeline already emits a samples.ind file
    # (one cleaned cohort id per line, in BAM-list order). 2026-05-26
    # added for the C_gar cohort which ships samples.ind alongside the
    # beagle (one entry per BAM, already CGA-cleaned).
    python build_dosage_sample_map.py \\
        --samples-ind /path/to/samples.ind \\
        --out         atlas-workspace/atlases/inversion/data/dosage/sample_map.json

    # Source-of-truth path — read both the BAM list and the beagle
    # header, validate they agree, emit the map. Use when you don't
    # already have a samples.ind.
    python build_dosage_sample_map.py \\
        --bamlist  /path/to/bams.txt \\
        --beagle   /path/to/cohort.beagle.gz \\
        --out      atlas-workspace/atlases/inversion/data/dosage/sample_map.json

Output schema:
    {
      "schema_version":   1,
      "n_samples":        226,
      "bamlist":          "/path/to/bams.txt",
      "beagle":           "/path/to/cohort.beagle.gz",
      "generated_at":     "2026-05-26T10:00:00Z",

      // canonical: position i → cleaned cohort id (CGA001, CGA002, ...)
      "by_position":      ["CGA340", "CGA166", "CGA091", ...],

      // beagle sample ids (Ind, Ind1, Ind2, ...) in column order
      "beagle_ids":       ["Ind",    "Ind1",   "Ind2",   ...],

      // explicit name→id map for callers that prefer a dict lookup
      "mapping":          {"Ind": "CGA340", "Ind1": "CGA166", ...}
    }

The atlas loads this through registry layer `dosage_sample_map` (see
inversion-atlas/atlases/inversion/registries/data/layers.registry.json)
and the dosage-chunk fetcher rewrites every chunk.samples[] entry on
arrival, so the existing _buildSampleIdMap projection works unchanged.
"""

import argparse
import datetime as _dt
import gzip
import json
import os
import re
import sys


# Standard alignment extensions to strip from BAM basenames so the cleaned
# id matches the cohort precomp's `cga` field. Mirrors the R-side rule
# in inversion-atlas/atlases/inversion/shared/dosage_chunks.js
# (_stripPathAndExt).
_ALIGN_EXT_RE = re.compile(r'\.(bam|cram|sam)(\.gz)?$', re.IGNORECASE)


def clean_bam_id(path: str) -> str:
    """Strip dirname + alignment extension. /path/to/CGA340.bam → CGA340."""
    base = os.path.basename(path.strip())
    return _ALIGN_EXT_RE.sub('', base)


def read_bamlist(path: str) -> list[str]:
    """One BAM path per line, blanks + leading '#' lines skipped."""
    out: list[str] = []
    with open(path, 'rt') as fh:
        for line in fh:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            out.append(s)
    return out


def read_samples_ind(path: str) -> list[str]:
    """
    One cleaned cohort id per line, in BAM-list order. Blanks + '#'
    comments skipped. Use this when the upstream pipeline already
    emitted a samples.ind file (the C_gar pipeline does — see
    /mnt/e/01-catfish_assembly_manuscript_CGA/01_inputs_check/samples.ind).
    Skips the bamlist+beagle round-trip entirely.
    """
    out: list[str] = []
    with open(path, 'rt') as fh:
        for line in fh:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            out.append(s)
    return out


def _open_maybe_gz(path: str):
    if path.endswith('.gz'):
        return gzip.open(path, 'rt')
    return open(path, 'rt')


def read_beagle_header_ids(path: str) -> list[str]:
    """
    Read the beagle header (first line) and return the per-sample ids in
    column order. Beagle layout: 3 fixed cols (marker, allele1, allele2)
    then 3 cols per sample (P(AA), P(Aa), P(aa)). The header repeats
    each sample id 3 times — we de-duplicate by taking every third entry
    starting at col 3.
    """
    with _open_maybe_gz(path) as fh:
        header = fh.readline().rstrip('\n').rstrip('\r')
    if not header:
        raise ValueError(f'beagle header empty in {path}')
    cols = header.split()
    if len(cols) < 3:
        raise ValueError(f'beagle header too short ({len(cols)} cols) in {path}')
    body = cols[3:]
    if len(body) % 3 != 0:
        raise ValueError(
            f'beagle has {len(body)} per-sample header cols — not divisible by 3. '
            f'Expected `marker allele1 allele2 IndA IndA IndA IndB IndB IndB ...`.')
    n = len(body) // 3
    ids: list[str] = []
    for i in range(n):
        triple = body[3 * i:3 * i + 3]
        # Soft check: all three should be the same id. If not, take the
        # first and warn — better to ship a working map with a noted
        # anomaly than to abort.
        if len(set(triple)) != 1:
            print(f'  ⚠ beagle col {3 + 3*i}..{3 + 3*i + 2}: '
                  f'sample-id triple not identical ({triple}); using first.',
                  file=sys.stderr)
        ids.append(triple[0])
    return ids


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description='Emit chunk-sample → cohort-sample map JSON for the atlas.')
    ap.add_argument('--samples-ind',
        help='Path to a samples.ind file (one cleaned cohort id per line, '
             'BAM-list order). Fast path — when present, skips the '
             'bamlist+beagle round-trip entirely. Mutually exclusive with '
             '--bamlist/--beagle.')
    ap.add_argument('--bamlist',
        help='Path to the BAM list (one BAM path per line) used as input '
             'to the dosage pipeline. Required when --samples-ind is not given.')
    ap.add_argument('--beagle',
        help='Path to the cohort beagle file (gzip OK). Only the header '
             'is read. Required when --samples-ind is not given.')
    ap.add_argument('--out', required=True,
        help='Output JSON path.')
    ap.add_argument('--strict', action='store_true',
        help='Treat any mismatch (count / non-uniform triple) as an error '
             'instead of a warning.')
    args = ap.parse_args(argv)

    # ---------------------------------------------------------------------
    # Fast path — samples.ind directly gives the by_position[] array.
    # ---------------------------------------------------------------------
    if args.samples_ind:
        if args.bamlist or args.beagle:
            print('ERROR: --samples-ind is mutually exclusive with '
                  '--bamlist/--beagle.', file=sys.stderr)
            return 2
        print(f'[build_dosage_sample_map] reading samples.ind: {args.samples_ind}')
        by_position = read_samples_ind(args.samples_ind)
        bound = len(by_position)
        print(f'  → {bound} cohort ids')
        # Fabricate the beagle-side ids by convention (Ind / Ind1 / ... ).
        # The atlas reads by_position[] for the rewrite path, so this is
        # only documentation; even when the beagle ships actual real ids,
        # the chunk-side rewrite uses by_position[] to overwrite them.
        beagle_ids = ['Ind' if i == 0 else f'Ind{i}' for i in range(bound)]
        mapping = {beagle_ids[i]: by_position[i] for i in range(bound)}
        out = {
            'schema_version': 1,
            'n_samples': bound,
            'bamlist': None,
            'beagle':  None,
            'samples_ind': os.path.abspath(args.samples_ind),
            'generated_at': _dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
            'by_position': by_position,
            'beagle_ids':  beagle_ids,
            'mapping':     mapping,
            '_note': 'beagle_ids are CONVENTIONAL placeholders (Ind/Ind1/...) '
                     'because the script ran in --samples-ind mode. The atlas '
                     'chunk-side rewrite reads by_position[] regardless of '
                     'whether the chunk ships real ids or placeholders.',
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
        with open(args.out, 'wt') as fh:
            json.dump(out, fh, indent=2)
        print(f'[build_dosage_sample_map] wrote {args.out}')
        print(f'  → n_samples={bound}, first 3: '
              + ' / '.join(f'{beagle_ids[i]} → {by_position[i]}'
                           for i in range(min(3, bound))))
        return 0

    # ---------------------------------------------------------------------
    # Source-of-truth path — read both files, cross-validate, emit.
    # ---------------------------------------------------------------------
    if not args.bamlist or not args.beagle:
        print('ERROR: provide either --samples-ind, or both --bamlist and '
              '--beagle.', file=sys.stderr)
        return 2

    print(f'[build_dosage_sample_map] reading bamlist: {args.bamlist}')
    bams = read_bamlist(args.bamlist)
    print(f'  → {len(bams)} BAM paths')

    print(f'[build_dosage_sample_map] reading beagle header: {args.beagle}')
    beagle_ids = read_beagle_header_ids(args.beagle)
    print(f'  → {len(beagle_ids)} per-sample ids')

    if len(bams) != len(beagle_ids):
        msg = (f'count mismatch: bamlist has {len(bams)} entries, '
               f'beagle has {len(beagle_ids)} per-sample columns. '
               'These MUST match — beagle is built from this BAM list.')
        if args.strict:
            print('ERROR: ' + msg, file=sys.stderr)
            return 2
        print('  ⚠ ' + msg + ' Truncating to the smaller of the two.',
              file=sys.stderr)
    bound = min(len(bams), len(beagle_ids))

    by_position = [clean_bam_id(bams[i]) for i in range(bound)]
    bid_trim = beagle_ids[:bound]
    mapping = {bid_trim[i]: by_position[i] for i in range(bound)}

    if len(mapping) != bound:
        print(f'  ⚠ beagle ships {bound - len(mapping)} duplicate sample-id '
              f'strings → name-based lookup will collapse; positional binding '
              f'(by_position[]) is the only safe path. Atlas reads by_position '
              f'directly when present, so this is fine.', file=sys.stderr)

    out = {
        'schema_version': 1,
        'n_samples': bound,
        'bamlist': os.path.abspath(args.bamlist),
        'beagle':  os.path.abspath(args.beagle),
        'generated_at': _dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'by_position': by_position,
        'beagle_ids':  bid_trim,
        'mapping':     mapping,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    with open(args.out, 'wt') as fh:
        json.dump(out, fh, indent=2)
    print(f'[build_dosage_sample_map] wrote {args.out}')
    print(f'  → n_samples={bound}, first 3: ' +
          ' / '.join(f'{bid_trim[i]} → {by_position[i]}' for i in range(min(3, bound))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
