// shared/candidate_region_stats_fetch.js
// =====================================================================
// On-the-fly fetch orchestrator for the candidate & karyotype page's
// per-region overdominance / POD stats. Given a candidate + the chrom's
// samples, POSTs to the popstats groupwise endpoint (FIS + theta_pi) and
// the SIFT deleterious endpoint, parses both, and stows the result on
// `candidate.region_stats` for the list renderer + TSV export to read.
//
// The POST function is injectable (opts.post) so the orchestration is
// unit-testable without a live server. SIFT failures are non-fatal (the
// endpoint is not wired yet) — the region_stats block still carries FIS +
// theta_pi, and the deleterious cell shows "—".
// =====================================================================
import {
  buildRegionStatsRequest, parseRegionStatsResponse, GROUPWISE_URL,
} from './candidate_region_stats.js';
import { buildSiftRequest, parseSiftResponse, SIFT_URL } from './sift_adapter.js';

async function _defaultPost(url, body) {
  if (typeof fetch !== 'function') return { ok: false, status: 0, error: 'no-fetch' };
  try {
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) { return { ok: false, status: 0, error: String(e) }; }
}

function _nowISO(now) {
  if (now) return now;
  try { return new Date().toISOString(); } catch (e) { return null; }
}

/**
 * Fetch + store region_stats for one candidate. Mutates candidate.region_stats.
 * @returns {Promise<Object>} the stored record (also on candidate.region_stats)
 */
export async function fetchRegionStats(candidate, samples, opts) {
  const o = opts || {};
  const post = o.post || _defaultPost;
  const out = {
    fis: NaN, theta_pi: NaN, n_sites: NaN,
    fis_by_group: null, theta_pi_by_group: null,
    sift: null, source: null, computed_at: _nowISO(o.now), errors: [],
  };

  const statsReq = buildRegionStatsRequest(candidate, samples, o);
  if (!statsReq) {
    out.errors.push('groupwise:norequest');
  } else {
    const r = await post(o.groupwiseUrl || GROUPWISE_URL, statsReq);
    const parsed = (r && r.ok && r.data) ? parseRegionStatsResponse(r.data) : null;
    if (parsed) {
      out.fis = parsed.fis; out.theta_pi = parsed.theta_pi;
      out.fis_by_group = parsed.fis_by_group; out.theta_pi_by_group = parsed.theta_pi_by_group;
      out.n_sites = parsed.n_sites; out.source = parsed.source;
    } else {
      out.errors.push('groupwise:' + (r && r.ok ? 'parse' : (r ? r.status : 'nofetch')));
    }
  }

  // Deleterious load (SIFT) — inert until the endpoint lands; non-fatal.
  if (!o.skipSift) {
    const siftReq = buildSiftRequest(candidate, samples, o);
    if (!siftReq) {
      out.errors.push('sift:norequest');
    } else {
      const r = await post(o.siftUrl || SIFT_URL, siftReq);
      const sp = (r && r.ok && r.data) ? parseSiftResponse(r.data) : null;
      if (sp) out.sift = sp;
      else out.errors.push('sift:' + (r && r.ok ? 'parse' : (r ? r.status : 'nofetch')));
    }
  }

  if (candidate) candidate.region_stats = out;
  return out;
}

/**
 * Fetch region_stats for many candidates sequentially (keeps the server
 * from being hammered). Returns the array of records.
 */
export async function fetchRegionStatsForAll(candidates, samples, opts) {
  const list = Array.isArray(candidates) ? candidates : [];
  const results = [];
  for (const c of list) {
    try { results.push(await fetchRegionStats(c, samples, opts)); }
    catch (e) { results.push(null); }
  }
  return results;
}
