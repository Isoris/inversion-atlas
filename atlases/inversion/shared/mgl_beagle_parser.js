// shared/mgl_beagle_parser.js
// =====================================================================
// Parse a PCAngsd-style Beagle GL file into a per-marker dosage
// matrix, ready for downstream PCA / heatmap compute.
//
// Beagle format (SPEC_0 §3.1):
//
//   marker  allele1  allele2  ind0  ind0  ind0  ind1  ind1  ind1  ...
//   LG28_15234521_MAJOR_MINOR1_A_G  0  2  0.05 0.92 0.03 0.95 0.04 0.01 …
//
// - Tab-separated. First 3 columns: marker name + integer allele
//   codes (A=0, C=1, G=2, T=3).
// - Each sample contributes 3 columns: GL(AA), GL(Aa), GL(aa)
//   normalised to sum to 1 across the triplet.
// - Tri-allelic sites contribute 3 rows; quad sites 6 rows. The
//   `marker` field encodes the site coordinate + which pair this
//   row is. The producer-side filter (`mgl_adapter/v5`) already
//   decided which pairs to keep — this parser just reads.
//
// Dosage = posterior expected copies of allele B per sample:
//   E[#B] = P(Aa) + 2 × P(aa)
//
// IO: takes ALREADY-DECOMPRESSED text. The caller is responsible
// for gunzip (the browser has DecompressionStream).
// =====================================================================

// =====================================================================
// 1. Header parsing
// =====================================================================

/**
 * Read the first non-blank line of a Beagle file and infer the
 * sample names from the column headers.
 *
 * Sample names occupy 3 consecutive columns each starting at
 * column index 3. PCAngsd repeats the sample name 3× (one per GL).
 *
 * @param {string} headerLine
 * @returns {{samples:string[], n_samples:number, expected_cols:number}}
 *   or `{samples: [], n_samples: 0}` when the header is malformed.
 */
export function parseBeagleHeader(headerLine) {
  if (typeof headerLine !== 'string') return { samples: [], n_samples: 0, expected_cols: 0 };
  const cols = headerLine.replace(/\r?\n$/, '').split('\t');
  if (cols.length < 6) return { samples: [], n_samples: 0, expected_cols: 0 };
  // Columns 0-2: marker, allele1, allele2.
  // Columns 3..end: 3 per sample. Sample names typically repeat 3×.
  const sampleCols = cols.slice(3);
  if (sampleCols.length % 3 !== 0) {
    return { samples: [], n_samples: 0, expected_cols: cols.length };
  }
  const n_samples = sampleCols.length / 3;
  const samples = new Array(n_samples);
  for (let i = 0; i < n_samples; i++) {
    // Take the first of the triplet. If they differ (some producers
    // write Ind0_AA / Ind0_Aa / Ind0_aa) strip a trailing _AA / _Aa
    // / _aa / _0 / _1 / _2 / etc. and use the common prefix.
    const trio = [sampleCols[i * 3], sampleCols[i * 3 + 1], sampleCols[i * 3 + 2]];
    samples[i] = _commonSampleName(trio);
  }
  return { samples, n_samples, expected_cols: cols.length };
}

function _commonSampleName(trio) {
  // Strip standard trailing tokens.
  const stripped = trio.map(s => s.replace(/_(AA|Aa|aa|GLAA|GLAa|GLaa|0|1|2)$/, ''));
  if (stripped[0] === stripped[1] && stripped[1] === stripped[2]) {
    return stripped[0];
  }
  // Fall back to the raw first column.
  return trio[0];
}

// =====================================================================
// 2. Full-file parser
// =====================================================================

/**
 * Parse a Beagle file (decompressed text) into a dosage matrix.
 *
 * Output is row-major (n_markers × n_samples) Float64Array — fast
 * for column-slice access during PCA.
 *
 * @param {string} text   the whole Beagle file as a string (gunzipped)
 * @param {Object} [opts]
 * @param {boolean} [opts.skipMalformedRows=true] — drop rows whose
 *   numeric column count doesn't match the header. When false,
 *   parsing throws on the first malformed row.
 * @returns {{
 *   markers:        string[],
 *   allele1:        Int8Array,
 *   allele2:        Int8Array,
 *   samples:        string[],
 *   n_markers:      number,
 *   n_samples:      number,
 *   dosage_matrix:  Float64Array,   // row-major (n_markers × n_samples)
 *   n_dropped:      number,         // malformed rows skipped
 * }|null}
 */
export function parseBeagleToDosage(text, opts) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const o = opts || {};
  const skipMalformed = o.skipMalformedRows !== false;
  // Split into lines lazily — for big files (10s of MB), iterating
  // the string char-by-char is what'd be cheapest, but split('\n')
  // is plenty for the candidate-sized files we expect (1-50 MB).
  const lines = text.split('\n');
  // Find the first non-blank line as the header.
  let hdrIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) { hdrIdx = i; break; }
  }
  if (hdrIdx === -1) return null;
  const header = parseBeagleHeader(lines[hdrIdx]);
  if (header.n_samples === 0) return null;

  // First pass: count data rows so we can pre-size the matrix.
  let n_data = 0;
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    if (lines[i].length === 0) continue;
    if (lines[i].trim().length === 0) continue;
    n_data++;
  }
  const markers = new Array(n_data);
  const allele1 = new Int8Array(n_data);
  const allele2 = new Int8Array(n_data);
  const dosage_matrix = new Float64Array(n_data * header.n_samples);
  const expectedCols = header.expected_cols;
  let row = 0;
  let n_dropped = 0;
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length === 0) continue;
    if (ln.trim().length === 0) continue;
    const cols = ln.replace(/\r$/, '').split('\t');
    if (cols.length !== expectedCols) {
      if (skipMalformed) { n_dropped++; continue; }
      throw new Error(`Beagle row ${i}: column count ${cols.length} != header ${expectedCols}`);
    }
    markers[row] = cols[0];
    allele1[row] = parseInt(cols[1], 10);
    allele2[row] = parseInt(cols[2], 10);
    // Compute dosage per sample: GL(Aa) + 2 × GL(aa).
    const off = row * header.n_samples;
    for (let s = 0; s < header.n_samples; s++) {
      const c = 3 + s * 3;
      const pAa = parseFloat(cols[c + 1]);
      const paa = parseFloat(cols[c + 2]);
      dosage_matrix[off + s] = (Number.isFinite(pAa) ? pAa : 0)
                             + 2 * (Number.isFinite(paa) ? paa : 0);
    }
    row++;
  }
  // If we skipped rows, trim the arrays.
  if (row < n_data) {
    return {
      markers:       markers.slice(0, row),
      allele1:       allele1.slice(0, row),
      allele2:       allele2.slice(0, row),
      samples:       header.samples,
      n_markers:     row,
      n_samples:     header.n_samples,
      dosage_matrix: dosage_matrix.slice(0, row * header.n_samples),
      n_dropped,
    };
  }
  return {
    markers,
    allele1, allele2,
    samples:       header.samples,
    n_markers:     n_data,
    n_samples:     header.n_samples,
    dosage_matrix,
    n_dropped,
  };
}

// =====================================================================
// 3. Sidecar (.pairs.tsv) parsing — merge metadata onto markers
// =====================================================================

/**
 * Parse a sidecar `.pairs.tsv` (SPEC_0 §3.2) into a Map keyed by
 * marker name → row of typed values. The map preserves insertion
 * order for downstream column-order semantics.
 *
 * Expected columns (per spec): marker, chrom, pos, n_alleles_obs,
 * site_total_count, role_a, role_b, allele_a, allele_b, count_a,
 * count_b, pair_count, pair_fraction, min_pair_allele_count,
 * n_samples_with_a, n_samples_with_b, n_samples_with_either,
 * maf_pair.
 *
 * @param {string} text
 * @returns {Map<string,Object>|null}
 */
export function parseBeagleSidecar(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const lines = text.split('\n');
  let hdrIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) { hdrIdx = i; break; }
  }
  if (hdrIdx === -1) return null;
  const header = lines[hdrIdx].replace(/\r?\n$/, '').split('\t');
  const numericCols = new Set([
    'pos', 'n_alleles_obs', 'site_total_count',
    'count_a', 'count_b', 'pair_count', 'pair_fraction',
    'min_pair_allele_count',
    'n_samples_with_a', 'n_samples_with_b', 'n_samples_with_either',
    'maf_pair',
  ]);
  const out = new Map();
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length === 0 || ln.trim().length === 0) continue;
    const cols = ln.replace(/\r$/, '').split('\t');
    const row = Object.create(null);
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      const val = cols[c];
      if (numericCols.has(key)) {
        row[key] = val == null || val === '' ? NaN : Number(val);
      } else {
        row[key] = val;
      }
    }
    if (row.marker) out.set(row.marker, row);
  }
  return out;
}

/**
 * Attach sidecar metadata to a parsed dosage result. Adds a
 * `metadata` array indexed parallel to `markers`. Markers not
 * present in the sidecar map get `null` metadata.
 *
 * @param {Object} parsed   output of parseBeagleToDosage
 * @param {Map<string,Object>} sidecarMap   output of parseBeagleSidecar
 * @returns {Object}        same object, with `metadata` field added
 */
export function attachSidecar(parsed, sidecarMap) {
  if (!parsed || !Array.isArray(parsed.markers) || !sidecarMap) return parsed;
  const md = new Array(parsed.n_markers);
  for (let i = 0; i < parsed.n_markers; i++) {
    md[i] = sidecarMap.get(parsed.markers[i]) || null;
  }
  parsed.metadata = md;
  return parsed;
}

// =====================================================================
// 4. Slice helpers (per-marker / per-sample row access)
// =====================================================================

/**
 * Get the n_samples dosage row for marker index `i`. Returns a
 * Float64Array view (zero-copy).
 *
 * @param {Object} parsed
 * @param {number} i  marker index
 * @returns {Float64Array|null}
 */
export function dosageRowForMarker(parsed, i) {
  if (!parsed || !parsed.dosage_matrix) return null;
  if (i < 0 || i >= parsed.n_markers) return null;
  const off = i * parsed.n_samples;
  return parsed.dosage_matrix.subarray(off, off + parsed.n_samples);
}

/**
 * Get the per-marker dosage column for sample index `s`. Allocates
 * a new Float64Array (the matrix is row-major; sample slices are
 * non-contiguous).
 *
 * @param {Object} parsed
 * @param {number} s  sample index
 * @returns {Float64Array|null}
 */
export function dosageColumnForSample(parsed, s) {
  if (!parsed || !parsed.dosage_matrix) return null;
  if (s < 0 || s >= parsed.n_samples) return null;
  const out = new Float64Array(parsed.n_markers);
  for (let i = 0; i < parsed.n_markers; i++) {
    out[i] = parsed.dosage_matrix[i * parsed.n_samples + s];
  }
  return out;
}
