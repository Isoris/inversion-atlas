// atlases/inversion/shared/manuscript_bundle.js
// =====================================================================
// SPEC_manuscript_bundle_export Slice 2 — boilerplate paragraph
// generators for the manuscript bundle.
//
// Pure (no DOM, no state). Takes a normalised candidate object (the
// catalogue's `buildCatalogueRows` output shape, plus optional
// karyotype counts + boundary metadata) and returns Markdown the user
// can paste into the Results section.
//
// The biological interpretation paragraph is NOT generated — that's the
// author's job. This module ships the parts the SPEC marks "templated":
// genomic coordinates, sample counts per karyotype, statistical test
// outputs, sub-cluster verdicts, cross-candidate Cramér's V, boundary
// resolution methods + uncertainties. Missing fields degrade
// gracefully — the sentence using a missing field is dropped, never
// rendered as `{placeholder}`.
//
// Usage:
//   import { renderCandidateParagraph, renderResultsBoilerplate }
//     from 'atlases/inversion/shared/manuscript_bundle.js';
//   const md = renderResultsBoilerplate(candidates, {
//     n_candidates_total: candidates.length,
//   });
// =====================================================================

const MB_PER_BP = 1 / 1_000_000;

/**
 * Render one candidate's Markdown paragraph per the SPEC §2 template.
 *
 * @param {object} cand                Normalised candidate row + extras.
 *   Required:  id, chr, start_bp, end_bp
 *   Optional:  seq_num, K, verdict, n_samples, n_ref, n_het, n_inv,
 *              p_value, cluster_verdict (nested|cross_cutting|...),
 *              n_pure, n_with_data, purity_threshold,
 *              neighbor: { id, start_bp, end_bp, cramers_v },
 *              boundary_5: { method, bp, ci_bp },
 *              boundary_3: { method, bp, ci_bp }
 * @param {object} [opts]
 * @param {number} [opts.n_candidates_total]  Used for Bonferroni note.
 * @returns {string}  Markdown paragraph (no trailing newline).
 */
export function renderCandidateParagraph(cand, opts) {
  if (!cand || typeof cand !== 'object') return '';
  const o = opts || {};
  const seq = Number.isFinite(cand.seq_num) ? cand.seq_num : null;
  const chrom = cand.chr || cand.chrom || '?';
  const startMb = _mb(cand.start_bp);
  const endMb   = _mb(cand.end_bp);
  const span = (Number.isFinite(cand.start_bp) && Number.isFinite(cand.end_bp))
    ? _mb(cand.end_bp - cand.start_bp) : null;

  const lines = [];

  // Heading
  const seqStr = seq != null ? ` ${seq}` : '';
  const coordStr = (startMb != null && endMb != null)
    ? `${chrom}, ${startMb}–${endMb} Mb`
    : `chromosome ${chrom}`;
  lines.push(`**Inversion${seqStr} — ${coordStr}**`);
  lines.push('');

  // Sentence 1 — span + karyotype counts
  const sent1Parts = [];
  if (span != null) {
    sent1Parts.push(`A putative inversion was identified spanning ${span} Mb on chromosome ${chrom}.`);
  } else {
    sent1Parts.push(`A putative inversion was identified on chromosome ${chrom}.`);
  }
  const K = Number.isFinite(cand.K) ? cand.K : null;
  if (K != null
      && Number.isFinite(cand.n_ref)
      && Number.isFinite(cand.n_het)
      && Number.isFinite(cand.n_inv)) {
    const nTotal = Number.isFinite(cand.n_samples)
      ? cand.n_samples
      : (cand.n_ref + cand.n_het + cand.n_inv);
    sent1Parts.push(
      `K=${K} PCA-based karyotype assignment yielded ${cand.n_ref} REF, ` +
      `${cand.n_het} HET, and ${cand.n_inv} INV samples ` +
      `(n total = ${nTotal}).`
    );
  } else if (Number.isFinite(cand.n_samples) && cand.n_samples > 0) {
    sent1Parts.push(`Karyotype assignment over n = ${cand.n_samples} samples is reported in Table S2.`);
  }
  lines.push(sent1Parts.join(' '));

  // Sentence 2 — Cochran–Armitage trend test
  if (Number.isFinite(cand.p_value)) {
    const pStr = _fmtP(cand.p_value);
    const totalForBonferroni = Number.isFinite(o.n_candidates_total) ? o.n_candidates_total : null;
    let s2 = `The Cochran-Armitage trend test on per-sample dosage support for ` +
             `the inverted arrangement was significant (p = ${pStr}`;
    if (totalForBonferroni && totalForBonferroni > 0) {
      s2 += `; Bonferroni-corrected across ${totalForBonferroni} candidates`;
    }
    s2 += ').';
    lines.push(s2);
  }

  // Sentence 3 — substructure verdict
  if (cand.cluster_verdict) {
    const verdict = String(cand.cluster_verdict);
    let s3 = `Sub-cluster substructure within the heterozygote class was ${verdict}`;
    const pureBits = [];
    if (Number.isFinite(cand.n_pure)) pureBits.push(`${cand.n_pure}`);
    if (Number.isFinite(cand.n_with_data)) pureBits.push(`${cand.n_with_data}`);
    const pureStr = pureBits.length === 2 ? `${pureBits[0]}/${pureBits[1]}` : null;
    const thr = Number.isFinite(cand.purity_threshold) ? cand.purity_threshold : null;
    if (pureStr || thr != null) {
      const parts = ['K=6 substructure verdict:'];
      if (pureStr) parts.push(`${pureStr} K=6 groups pure`);
      if (thr != null) parts.push(`at purity ≥ ${thr}`);
      s3 += ` (${parts.join(' ')}).`;
    } else {
      s3 += '.';
    }
    lines.push(s3);
  }

  // Sentence 4 — neighbor Cramér's V
  const nb = cand.neighbor;
  if (nb && nb.id && Number.isFinite(nb.cramers_v)) {
    const adjCoord = (Number.isFinite(nb.start_bp) && Number.isFinite(nb.end_bp))
      ? ` at ${_mb(nb.start_bp)}–${_mb(nb.end_bp)} Mb` : '';
    const indicates = nb.cramers_v >= 0.5 ? 'indicating' : 'not indicating';
    lines.push(
      `Inheritance Cramér's V with the next adjacent candidate ` +
      `(${nb.id}${adjCoord}) was ${nb.cramers_v.toFixed(3)}, ` +
      `${indicates} shared chromosome ancestry.`
    );
  }

  // Sentence 5 — boundary resolution
  const b5 = cand.boundary_5;
  const b3 = cand.boundary_3;
  if ((b5 && b5.method) || (b3 && b3.method)) {
    const parts = ['Boundary resolution:'];
    const bits = [];
    if (b5 && b5.method) {
      const ci = Number.isFinite(b5.ci_bp) ? ` ± ${_kb(b5.ci_bp)} kb` : '';
      const at = Number.isFinite(b5.bp) ? ` (${_mb(b5.bp)} Mb${ci})` : '';
      bits.push(`5'-end ${b5.method}${at}`);
    }
    if (b3 && b3.method) {
      const ci = Number.isFinite(b3.ci_bp) ? ` ± ${_kb(b3.ci_bp)} kb` : '';
      const at = Number.isFinite(b3.bp) ? ` (${_mb(b3.bp)} Mb${ci})` : '';
      bits.push(`3'-end ${b3.method}${at}`);
    }
    lines.push(parts.concat(bits).join(' ') + '.');
  }

  return lines.join('\n');
}

/**
 * Render the full Results boilerplate by joining one paragraph per
 * candidate with blank lines. Candidates are NOT re-sorted — caller
 * controls order (typically chrom-sorted).
 *
 * @param {Array<object>} candidates
 * @param {object} [opts]   forwarded to renderCandidateParagraph
 * @returns {string}
 */
export function renderResultsBoilerplate(candidates, opts) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '_No confirmed candidates to report._';
  }
  const total = candidates.length;
  const optsWithTotal = Object.assign({}, opts || {}, {
    n_candidates_total: (opts && Number.isFinite(opts.n_candidates_total))
      ? opts.n_candidates_total : total,
  });
  return candidates
    .map((c, i) => renderCandidateParagraph(
      Object.assign({ seq_num: i + 1 }, c),
      optsWithTotal,
    ))
    .filter(s => s.length > 0)
    .join('\n\n');
}

/**
 * Build the README content for the bundle's top level. Lists every file
 * in the bundle with a one-line description, plus generation metadata.
 *
 * @param {object} meta   { atlas_version, generated_at, n_candidates,
 *                          chrom_set, params? }
 * @returns {string}
 */
export function renderBundleReadme(meta) {
  const m = meta || {};
  const date = m.generated_at || new Date().toISOString();
  const version = m.atlas_version || '(unknown)';
  const n = Number.isFinite(m.n_candidates) ? m.n_candidates : 0;
  const chromList = Array.isArray(m.chrom_set) ? m.chrom_set.join(', ') : '';
  const lines = [
    `# Manuscript bundle`,
    ``,
    `Generated: ${date}`,
    `Atlas version: ${version}`,
    `Confirmed candidates: ${n}`,
  ];
  if (chromList) lines.push(`Chromosome set: ${chromList}`);
  lines.push('');
  lines.push(`## Files`);
  lines.push('');
  lines.push('| file | contents |');
  lines.push('|---|---|');
  lines.push('| `candidate_catalogue.tsv` | One row per confirmed candidate, tab-separated. |');
  lines.push('| `candidate_catalogue.json` | Same data as TSV, JSON-formatted. |');
  lines.push('| `methods_boilerplate.md` | Paste-ready prose for the §Methods section. |');
  lines.push('| `results_boilerplate.md` | Paste-ready paragraph per candidate (Inversion 1 — …). |');
  lines.push('| `supplementary_table_S1.tsv` | Full candidate list with evidence breakdown. |');
  lines.push('| `supplementary_table_S2.tsv` | Per-sample × per-candidate karyotype matrix. |');
  lines.push('| `figures/` | Manuscript figures as SVG (where available). |');
  lines.push('| `atlas_links.md` | Per-candidate URL anchors back into the atlas pages. |');
  lines.push('| `generation_metadata.json` | Atlas version, date, chrom set, generation params. |');
  lines.push('');
  lines.push(`## What this bundle does NOT include`);
  lines.push('');
  lines.push(`- Biological interpretation`);
  lines.push(`- Selection / breeding implications`);
  lines.push(`- Cross-species comparisons (beyond what's in the catalogue)`);
  lines.push(`- The Discussion / Abstract / Significance statement`);
  lines.push('');
  lines.push(`These remain the author's responsibility (per SPEC §7).`);
  return lines.join('\n');
}

/**
 * Supplementary Table S1 — every column from the catalogue TSV plus
 * the per-evidence breakdown the SPEC calls for. Pure TSV; one header
 * row + one data row per candidate.
 *
 * Columns:
 *   seq_num, id, chr, start_bp, end_bp, span_kb, K, verdict, source,
 *   n_samples, n_ref, n_het, n_inv, p_value,
 *   silhouette, coherence, fam_purity, cluster_ok,
 *   neighbor_id, neighbor_cramers_v,
 *   boundary_5_method, boundary_5_bp, boundary_5_ci_bp,
 *   boundary_3_method, boundary_3_bp, boundary_3_ci_bp
 *
 * Missing fields render as the empty string (NOT 'null' / 'undefined')
 * so downstream TSV readers don't choke on Python's `pd.read_csv` na-detection.
 *
 * @param {Array<object>} candidates
 * @returns {string}
 */
export function renderSupplementaryTableS1(candidates) {
  const cols = [
    'seq_num', 'id', 'chr', 'start_bp', 'end_bp', 'span_kb',
    'K', 'verdict', 'source',
    'n_samples', 'n_ref', 'n_het', 'n_inv', 'p_value',
    'silhouette', 'coherence', 'fam_purity', 'cluster_ok',
    'neighbor_id', 'neighbor_cramers_v',
    'boundary_5_method', 'boundary_5_bp', 'boundary_5_ci_bp',
    'boundary_3_method', 'boundary_3_bp', 'boundary_3_ci_bp',
  ];
  const lines = [cols.join('\t')];
  if (!Array.isArray(candidates)) return lines.join('\n');
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || typeof c !== 'object') continue;
    const nb = c.neighbor || {};
    const b5 = c.boundary_5 || {};
    const b3 = c.boundary_3 || {};
    const row = [
      Number.isFinite(c.seq_num) ? c.seq_num : (i + 1),
      _tsv(c.id),
      _tsv(c.chr || c.chrom),
      _num(c.start_bp),
      _num(c.end_bp),
      _num(c.span_kb),
      _num(c.K),
      _tsv(c.verdict),
      _tsv(c.source),
      _num(c.n_samples),
      _num(c.n_ref),
      _num(c.n_het),
      _num(c.n_inv),
      Number.isFinite(c.p_value) ? c.p_value : '',
      _num(c.silhouette),
      _num(c.coherence),
      _num(c.fam_purity),
      typeof c.cluster_ok === 'boolean' ? (c.cluster_ok ? 'true' : 'false') : '',
      _tsv(nb.id),
      _num(nb.cramers_v),
      _tsv(b5.method),
      _num(b5.bp),
      _num(b5.ci_bp),
      _tsv(b3.method),
      _num(b3.bp),
      _num(b3.ci_bp),
    ];
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Supplementary Table S2 — sample × candidate karyotype matrix. One row
 * per sample, one column per candidate. Cell values are the karyotype
 * label (REF | HET | INV | NA) or, when label_map isn't provided, the
 * raw K-band id from candidate.locked_labels (0..K-1) or 'NA' for
 * samples without a label.
 *
 * @param {Array<object>} candidates  Each must carry `id`. When the
 *   candidate has `locked_labels: Int8Array | number[]` of length
 *   n_samples, those drive the column. When it carries an optional
 *   `label_map: {[band_id]: 'REF'|'HET'|'INV'}` map, the cells render
 *   the readable label instead of the raw band id.
 * @param {Array<{id?: string, cga?: string, sample?: string}>} samples
 *   The order of samples controls the row order; the first column is
 *   the sample id (preferred: `cga`, then `id`, then `sample`, then 'S{i}').
 * @returns {string}
 */
export function renderKaryotypeMatrix(candidates, samples) {
  const cands = Array.isArray(candidates) ? candidates : [];
  const samps = Array.isArray(samples) ? samples : [];
  const header = ['sample'].concat(cands.map(c => (c && c.id) || `cand${cands.indexOf(c)}`));
  const lines = [header.join('\t')];
  for (let si = 0; si < samps.length; si++) {
    const s = samps[si];
    const sid = (s && (s.cga || s.id || s.sample || s.ind)) || `S${si}`;
    const row = [sid];
    for (const c of cands) {
      row.push(_cellForSample(c, si));
    }
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Render `atlas_links.md` — one section per candidate with deep links
 * back into the atlas pages so a reviewer reading the manuscript can
 * jump straight to the relevant atlas view. Generates page-level
 * anchors today (the router doesn't parse query params yet); the
 * candidate / chrom hints in the URL are forward-compatible and act
 * as readable annotations regardless.
 *
 * @param {Array<object>} candidates  Each: { id, chr, start_bp, end_bp }.
 * @param {object} [opts]
 * @param {string} [opts.base_url]    Prepended to every link (default '').
 * @param {string} [opts.atlas_id]    Default 'inversion'.
 * @returns {string}
 */
export function renderAtlasLinks(candidates, opts) {
  const o = opts || {};
  const base = (typeof o.base_url === 'string') ? o.base_url : '';
  const atlas = (typeof o.atlas_id === 'string' && o.atlas_id.length > 0)
    ? o.atlas_id : 'inversion';
  const cands = Array.isArray(candidates) ? candidates : [];
  if (cands.length === 0) {
    return '_No candidates to link._';
  }
  const lines = [
    `# Atlas links — per-candidate review entry points`,
    ``,
    `Each section below has direct links to the atlas pages a reviewer`,
    `is most likely to want for that candidate. Open in the same atlas`,
    `tab the manuscript came from. Today the router navigates to the`,
    `page; the \`?candidate_id=\` / \`?chrom=\` hints are forward-`,
    `compatible (router param-parsing is a future increment).`,
    ``,
  ];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c || typeof c !== 'object' || !c.id) continue;
    const chrom = c.chr || c.chrom || '?';
    const startMb = _mb(c.start_bp);
    const endMb   = _mb(c.end_bp);
    const coordStr = (startMb != null && endMb != null)
      ? `${chrom} ${startMb}–${endMb} Mb`
      : `chromosome ${chrom}`;
    lines.push(`## ${c.id} — ${coordStr}`);
    lines.push('');
    for (const link of _candidateLinks(c, base, atlas, chrom)) {
      lines.push(`- ${link}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function _candidateLinks(c, base, atlas, chrom) {
  const id = encodeURIComponent(c.id);
  const ch = encodeURIComponent(chrom);
  const candHint = `?candidate_id=${id}`;
  const chromHint = `?chrom=${ch}`;
  const root = `${base}#/${atlas}`;
  return [
    `[Catalogue row](${root}/catalogue${candHint})`,
    `[Candidate focus — multi-panel deep-dive](${root}/candidate_focus${candHint})`,
    `[Boundary refinement](${root}/boundary_refinement${candHint})`,
    `[Haplotype regimes (chrom ${chrom})](${root}/haplotype_regimes${chromHint})`,
    `[Local PCA on dosage (chrom ${chrom})](${root}/local_pca_dosage${chromHint})`,
  ];
}

function _cellForSample(cand, si) {
  if (!cand || !cand.locked_labels) return 'NA';
  const lab = cand.locked_labels[si];
  if (lab == null || lab < 0) return 'NA';
  const map = cand.label_map;
  if (map && typeof map === 'object' && map[lab] != null) return String(map[lab]);
  return String(lab);
}

/**
 * SPEC §1 Slice 1 — assemble the full bundle as a single .zip Blob.
 *
 * Composes every output from the helpers above into the file layout
 * the SPEC documents. Figures (Slice 4) are skipped when no SVGs are
 * provided; the bundle is still a valid zip with the text artifacts.
 *
 * @param {object} args
 * @param {Array<object>} args.candidates  Confirmed candidates.
 * @param {Array<object>} [args.samples]   Required for the karyotype matrix.
 * @param {object}        [args.meta]      Forwarded to renderBundleReadme.
 * @param {Array<{name: string, svg: string|Uint8Array}>} [args.figures]
 * @param {object}        [args.linkOpts]  Forwarded to renderAtlasLinks.
 * @param {string}        [args.catalogueTSV]  Pre-rendered catalogue TSV
 *   from the existing catalogue export; passes through unchanged so the
 *   bundle's `candidate_catalogue.tsv` matches what page-3 already emits.
 * @param {string}        [args.methodsBoilerplate]  Custom methods text;
 *   defaults to a stub when omitted.
 * @returns {Promise<Blob>}
 */
export async function buildManuscriptBundleBlob(args) {
  const a = args || {};
  const candidates = Array.isArray(a.candidates) ? a.candidates : [];
  const samples    = Array.isArray(a.samples)    ? a.samples    : [];
  const meta = Object.assign({
    n_candidates: candidates.length,
    generated_at: new Date().toISOString(),
  }, a.meta || {});

  // Dynamic import so callers that only want the text helpers don't pay
  // the zip-writer cost. zip_store is ~150 LOC + a 256-entry CRC table.
  const { createZip } = await import('./zip_store.js');
  const zip = createZip();

  zip.addText('README.md', renderBundleReadme(meta));
  zip.addText(
    'candidate_catalogue.tsv',
    typeof a.catalogueTSV === 'string' && a.catalogueTSV.length > 0
      ? a.catalogueTSV
      : renderSupplementaryTableS1(candidates));
  zip.addText('candidate_catalogue.json',
    JSON.stringify(candidates, null, 2));
  zip.addText('methods_boilerplate.md',
    typeof a.methodsBoilerplate === 'string' && a.methodsBoilerplate.length > 0
      ? a.methodsBoilerplate
      : _stubMethodsBoilerplate(meta));
  zip.addText('results_boilerplate.md',
    renderResultsBoilerplate(candidates));
  zip.addText('supplementary_table_S1.tsv',
    renderSupplementaryTableS1(candidates));
  zip.addText('supplementary_table_S2.tsv',
    renderKaryotypeMatrix(candidates, samples));
  zip.addText('atlas_links.md',
    renderAtlasLinks(candidates, a.linkOpts || {}));
  zip.addText('generation_metadata.json',
    JSON.stringify(meta, null, 2));

  // Figures: caller supplies pre-rendered SVG strings/bytes. Slice 4 will
  // ship the SVG renderers; until then, this is the integration point.
  if (Array.isArray(a.figures)) {
    for (const f of a.figures) {
      if (!f || typeof f.name !== 'string' || f.name.length === 0) continue;
      const path = `figures/${f.name}`;
      if (f.svg instanceof Uint8Array)        zip.addBytes(path, f.svg);
      else if (typeof f.svg === 'string')     zip.addText(path, f.svg);
    }
  }

  return zip.toBlob();
}

function _stubMethodsBoilerplate(meta) {
  return [
    '# Methods (boilerplate stub)',
    '',
    `Atlas version: ${meta.atlas_version || '(unknown)'}.`,
    `Generated: ${meta.generated_at || ''}.`,
    '',
    '_This file is a placeholder. Slice 2 of SPEC_manuscript_bundle_export',
    'will populate it with one paragraph per pipeline stage that touches a',
    'candidate. Until then, the Results boilerplate (results_boilerplate.md)',
    'is the primary text artefact._',
  ].join('\n');
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function _tsv(v) {
  if (v == null) return '';
  // Strip tabs/newlines from string cells to keep one logical record per line.
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

function _num(v) {
  return Number.isFinite(v) ? String(v) : '';
}

function _mb(bp) {
  if (!Number.isFinite(bp)) return null;
  return (bp * MB_PER_BP).toFixed(2);
}

function _kb(bp) {
  if (!Number.isFinite(bp)) return null;
  return (bp / 1000).toFixed(1);
}

function _fmtP(p) {
  if (!Number.isFinite(p)) return '?';
  if (p === 0) return '< 1e-300';
  if (p >= 0.01) return p.toFixed(3);
  // Scientific notation for very small p.
  return p.toExponential(2);
}
