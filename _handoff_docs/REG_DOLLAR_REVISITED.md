# Re: ChatGPT's expanded `reg$` list

**Short version:** the underlying worry — "we have many data domains
and I don't want to forget any when planning" — is a real worry and
worth taking seriously. The proposed solution (a `reg$` global with
12+ shelves) is still the wrong shape. But it points at something we
should actually do: write down the inventory of data domains so
nothing slips through the planning cracks.

I don't think ChatGPT is wrong about *what we have to plan for*. I
think it's wrong about *what to build to track it*. Different fix.

---

## The legitimate worry behind the proposal

If you're trying to plan ahead — does our architecture cover X, Y, Z
biological domains? — and you don't have a written list of domains,
you'll forget one. ChatGPT is implicitly proposing: "make the list
manifest in code, as a global object, then we can't forget."

That instinct is correct. Forgetting domains during planning is a
real failure mode. The fix is **a written domain inventory**, not
**a runtime god-object**.

---

## Why the runtime god-object is still the wrong shape

Three reasons that don't go away just because the list got longer:

1. **Name collision with `reg$`.** Same as before — `reg$` already
   means the R-side toolkit registry. A second `reg$` in the browser
   will ruin every conversation about which one we mean.

2. **The grouping already exists in the layer-key namespace.** Look
   at the 37 layer entries currently in `layers.registry.json` —
   they're already grouped by prefix:
   - `candidate_*` (10 entries)
   - `cohort_*` (5 entries)
   - `band_*` (3 entries)
   - `dosage_*` (2 entries)
   - etc.

   A `reg$.inversion.X` shelf is just `registry.resolve('candidate_X', args)`
   under a different name. It doesn't add anything except a second
   way to ask the same question. Pages would have to know which API
   to use; refactoring becomes harder, not easier.

3. **Most of the proposed shelves are empty.** Out of the 12 shelves
   ChatGPT lists, the actual data we have today maps to maybe 4 or
   5. The rest (`reg$.recombination`, `reg$.crossSpecies`,
   `reg$.burden`, `reg$.markers`) point at data that's either future
   work or a single file. Building 12 shelves now means 7 of them
   start as scaffolding looking for content. That's the architecture
   smell: when the framework has more vocabulary than the data does.

---

## What's actually useful from the expanded list

ChatGPT's list, taken as a **planning checklist** rather than a code
spec, is genuinely useful. It's a fairly complete enumeration of the
biological data domains the Atlas touches. We should keep it as a
domain inventory and use it to verify that the registry-and-write
plumbing covers each one.

Filtered by what we actually have or are imminently building:

| Domain | Existing layer prefix | Status today |
|---|---|---|
| Sample metadata | `cohort_sample_*`, `cohort_natora_pruned` | ✅ exists |
| Relatedness | `cohort_relatedness`, `trio_inventory` | ⚠️ placeholder schema; lane B piece 2 |
| Ancestry | `ancestry_q_groupwise` | ✅ exists, server-driven |
| Diversity | `cohort_diversity`, `cohort_sample_froh`, `fst_dxy_thetapi_groupwise`, `hobs_groupwise` | ✅ exists |
| Local PCA / band tracking | `band_*`, `scrubber_main`, `het_band_backbones`, `transition_events` | ✅ exists |
| Inversion candidates | `candidate_*` (10 entries) | ⚠️ flat — needs versioning (lane B piece 1) |
| SV evidence | `candidate_sv_counts`, `cs_breakpoints` | ✅ exists |
| Markers | `candidate_marker_primers` | ✅ stub exists |
| Recombination | (none) | ❌ not yet — pyrho is future |
| Cross-species synteny | `synteny_multispecies` | ✅ exists (single layer) |
| LoF / burden | (none) | ❌ not yet |
| TE / repeats | `repeat_density`, `te_fragility` | ✅ exists |
| Catalogues | `candidate_final_class`, `candidate_breeding_card`, `manual_review_queue` | ✅ exists |
| Phylo | `phylo_tree` | ✅ exists |

That's a real inventory grounded in what's actually in
`layers.registry.json`. It's more honest than the speculative list
and tells us:

- The plumbing in lane B (versioning, write-path, transitive
  invalidation) needs to **work for every row of this table that has
  a ✅ today.** That's the architecture-readiness test.
- The ❌ rows are future content that fits the existing framework
  (just add a layer entry when the data exists). They don't drive
  any architectural change.
- The ⚠️ rows are exactly what lane B piece 1 and piece 2 are about.

---

## What I'd actually do

Two small additions to the lane B plan, no change to the structure:

### Addition 1 — write a `DATA_DOMAINS.md` inventory

A single doc in `atlas-core/docs/` with the table above (or a fuller
version of it). Each row names: domain, layer prefix, server
endpoints if any, schema status, who writes it (pipeline / browser /
both), example consumers.

This is the "checklist so we don't forget anything" that ChatGPT was
trying to encode in `reg$`. As a doc it's reviewable, diffable,
update-on-PR. As a runtime object it's just typing.

Effort: ~1 hour. Output: one file, ~150 lines.

### Addition 2 — verify lane B plumbing against the inventory

Walk down the table. For each domain with ✅ status, ask:

- Will candidate versioning (piece 1) need to know about this
  domain? (Mostly: only `candidate_*` and `cohort_*` are touched.)
- Will the write-path (piece 3) need to write back to this domain?
  (Only `candidate_*` evidence, for now.)
- If we add transitive invalidation keyed on `candidate_id`, does
  this domain's cache key contain `candidate_id`? (Most do; some
  cohort-level layers don't, and that's correct — invalidating
  `cohort_relatedness` when one candidate refines is wrong.)

This is a 30-minute mental walk-through, not a coding task. Output
is a one-paragraph note in the lane B plan saying "verified against
inventory, X domains affected, Y not affected."

---

## The thing ChatGPT got right that's worth keeping

The proposal says, repeatedly:

> reg$ knows data.
> analysis knows science.
> page knows display.

This three-way split is exactly the existing design. When ChatGPT
rephrases it as a global object, the rephrasing is wrong. When
ChatGPT says it as a discipline — "scientific decisions go in
analysis modules, not in registry methods, never in pages" — that's
just the architecture we already have, restated.

The proposal's actual content (when we strip out the `reg$`
formalism):

- Don't put Mendelian filtering inside the registry. ✅ already true.
- Don't put file paths inside analysis modules. ✅ already true.
- Don't put schema parsing inside pages. ✅ already true.
- Per-tool API shouldn't be hardcoded into the registry surface.
  ✅ — encode as arguments.
- Versioned candidates should be a real entity. ✅ — that's lane B
  piece 1.
- Analysis outputs should be saved through the registry, not by
  hand-rolling fetch calls. ✅ — that's lane B piece 3.

So the proposal *agrees with us* on the actual architectural
discipline. We disagree on whether to add a 13-shelf global object
to enforce it. I say: the discipline is enforced by the existing
file structure (`analysis/`, `core/`, `pages/`) and reviewed at
PR-time; a runtime object enforces nothing at runtime that the file
layout doesn't already enforce at write-time.

---

## Direct answer to "is ChatGPT wrong?"

ChatGPT is **right about the worry** (don't forget data domains
during planning) and **right about the discipline** (data / science /
display separation). It's **wrong about the implementation** (a
runtime `reg$` object adds API surface, not safety) and the proposed
implementation **conflicts with an existing name** (`reg$` is taken).

The fix to the worry is a written inventory, not a runtime object.
The fix to the discipline is the existing file layout, not a new
namespace. Both fixes are smaller than what ChatGPT proposed and
neither requires an architectural change.

---

## Recommendation

Don't build the `reg$` global. Add `DATA_DOMAINS.md` to the lane B
work. When the next chat starts on candidate versioning, the first
thing it does is look at `DATA_DOMAINS.md`, confirm which rows are
affected, and proceed. That's the "don't forget anything" guarantee,
in the smallest form that actually works.

If you want, I can write `DATA_DOMAINS.md` now as the warm-up to
lane B piece 1 — it's the kind of audit-doc that's also useful as
input to the schema-design session. Or we can leave it for the next
chat. Your call.
