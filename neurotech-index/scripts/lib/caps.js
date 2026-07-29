/**
 * caps.js — the per-granularity rubric ceilings.
 *
 * From docs/potential-impact-input-granularity.md, which resolved open decision
 * 1 with measured numbers: about 28% of this corpus can ever reach full text
 * (99.8% is PubMed, 43.8% of recent in-scope PMIDs reach PMC, 65% of those are
 * open access). A single global cap would either discard that 28% or license
 * scores the rest cannot support, so the cap is per item and recorded per item.
 *
 * These bind alongside the record-coverage ceiling in
 * src/lib/frontier-coverage.js, and the LOWER of the two wins.
 */
export const GRANULARITY_CAPS = {
  // Methods available. No cap beyond the rubric itself.
  full_text: { FD: 4, METH: 4 },
  // Endpoints and arms are declared registry fields, so METH is fully
  // assessable even though this is not full text.
  registry: { FD: 4, METH: 4 },
  // A tradeoff collapse can still be read from an abstract when both paired
  // values are reported, so FD 4 stays reachable via a curated pair. METH 3
  // needs endpoint detail an abstract rarely gives.
  abstract: { FD: 4, METH: 2 },
  // Nothing to score against. Leverage and gate paths only.
  metadata: { FD: 0, METH: 0 },
}
