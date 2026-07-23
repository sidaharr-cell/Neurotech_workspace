/**
 * classify.js — the one classifier. Every ingest script calls this; every page
 * reads what it wrote.
 *
 * Applies sources in strict precedence, highest first:
 *   1. curated vocabulary  MeSH · CPC · FDA product code · trial fields
 *   2. keyword rules       named content fields only, whole-word matching
 *   3. roll-up             labs/researchers inherit from their own output
 *   4. abstain             leave empty rather than guess
 *
 * Deterministic: no model calls, no randomness. Same row in, same facets out.
 */
import { keywordFacets, mergeFacets, normalizeFacets, isEmptyFacets, CLASSIFIER_VERSION } from './facets.js'
import { facetsForProductCode, isProductCodeInScope, productCodeOf } from './product-codes.js'
import { MESH_FACETS, meshFacets, isMeshInScope } from './mesh-map.js'

export { CLASSIFIER_VERSION }

// ── CPC → facets (patents) ──────────────────────────────────────────────────
// Only 7.8% of patents have an abstract, so the classification code carries
// almost all the weight here.
const CPC_FACETS = [
  // "Electrodes for implantation" says implanted, but NOT whether the electrode
  // sits on a surface or enters tissue — a DBS lead and a cortical grid share
  // this code. Asserting a depth here was wrong: it cost precision on
  // implanted_non_penetrating and recall on implanted_penetrating. Leave access
  // unknown and let MeSH or keywords answer it.
  ['A61N1/05',  { function: ['stimulates'], access: [], application: [] }],
  ['A61N1/36',  { function: ['stimulates'], access: [], application: [] }],
  ['A61N1/372', { function: ['stimulates'], access: [], application: [] }],
  ['A61N1/375', { function: ['stimulates'], access: [], application: [] }],
  ['A61N1/378', { function: ['stimulates'], access: [], application: [] }],
  ['A61N2/00',  { function: ['stimulates'], access: ['non_invasive'], application: [] }],
  ['A61B5/369', { function: ['records'], access: ['non_invasive'], application: [] }],
  ['A61B5/372', { function: ['images'], access: ['non_invasive'], application: [] }],
  ['A61B5/377', { function: ['records'], access: ['non_invasive'], application: ['diagnostics'] }],
  ['A61B5/378', { function: ['records'], access: ['non_invasive'], application: ['diagnostics'] }],
  ['A61B5/388', { function: ['records'], access: ['non_invasive'], application: [] }],
  ['A61B5/389', { function: ['records'], access: ['non_invasive'], application: [] }],
  ['A61B5/291', { function: ['records'], access: ['non_invasive'], application: [] }],
  ['A61B5/293', { function: ['records'], access: ['non_invasive'], application: [] }],
  ['G06F3/015', { function: ['records', 'decodes'], access: [], application: [] }],
  ['A61F2/72',  { function: ['records'], access: [], application: ['movement_restoration'] }],
]

export function cpcFacets(codes) {
  const sets = []
  for (const raw of codes || []) {
    const c = String(raw).replace(/\s+/g, '')
    for (const [prefix, f] of CPC_FACETS) if (c.startsWith(prefix)) sets.push(f)
  }
  return sets.length ? mergeFacets(...sets) : null
}

// ── Named content fields, per content type ──────────────────────────────────
// Never the whole record: author names, journals, URLs and ids are excluded so
// they cannot trigger a match.
export function contentOf(row, type) {
  const m = row.metadata || {}
  const parts = {
    papers: [row.title, row.abstract],
    patents: [row.title, row.abstract],
    devices: [row.name, row.description],
    trials: [row.title, row.summary, (m.conditions || []).join(' '), (m.interventions || []).join(' ')],
    news: [row.title, row.summary],
    organizations: [row.name, row.description],
    researchers: [row.name, row.bio, row.role],
  }[type] || []
  return parts.filter(Boolean).join(' \n ')
}

// ── Scope ───────────────────────────────────────────────────────────────────

/**
 * Trials whose interventions are ALL drugs or biologics are out of scope.
 *
 * Anything else is only a hint, not proof — "Procedure:", "Other:" and bare
 * intervention names say nothing about whether a neurotechnology is involved.
 * So this returns false (confident) or null (fall through to whether anything
 * actually classified). Asserting true here marked 99% of trials in scope while
 * a third of them classified to nothing.
 */
function trialIsDrugOnly(row) {
  const iv = row.metadata?.interventions || []
  if (!iv.length) return null
  const isDrug = s => /^(drug|biological|dietary supplement):/i.test(String(s))
  return iv.every(isDrug) ? false : null
}

/**
 * Is this row neurotechnology at all?
 * Returns true / false, or null when no authoritative signal exists (the caller
 * then falls back to whether anything classified).
 */
export function scopeOf(row, type) {
  switch (type) {
    case 'devices': {
      const code = row.product_code || productCodeOf(row)
      return code ? isProductCodeInScope(code) : null
    }
    case 'patents':
      // Presence in the index already means a neurotech CPC prefix matched.
      return (row.cpc_codes || []).length ? true : null
    case 'papers': {
      const mesh = row.mesh || []
      return mesh.length ? isMeshInScope(mesh) : null
    }
    case 'trials':
      return trialIsDrugOnly(row)
    default:
      return null
  }
}

// ── The classifier ──────────────────────────────────────────────────────────

/**
 * @param {object} row   a database row
 * @param {string} type  papers | patents | devices | trials | news | organizations | researchers
 * @param {object} [opts.rollup]  precomputed facets for labs/researchers
 */
export function classify(row, type, opts = {}) {
  const sources = []

  // 1 — curated vocabulary
  if (type === 'devices') {
    const code = row.product_code || productCodeOf(row)
    const f = code ? facetsForProductCode(code) : null
    if (f) sources.push(f)
  }
  if (type === 'patents') {
    const f = cpcFacets(row.cpc_codes)
    if (f) sources.push(f)
  }
  if (type === 'papers' && (row.mesh || []).length) {
    const f = meshFacets(row.mesh)
    if (f) sources.push(f)
  }

  // 2 — keyword rules over named fields.
  // Devices are the exception: the product code is authoritative and trade
  // names are exactly what produced the old false positives, so we do not
  // fall back to text when a code already answered.
  const vocabAnswered = sources.length > 0
  const skipKeywords = type === 'devices' && vocabAnswered
  if (!skipKeywords) sources.push(keywordFacets(contentOf(row, type)))

  // 3 — roll-up for labs and researchers
  if (opts.rollup) sources.push(opts.rollup)

  const facets = sources.length ? mergeFacets(...sources) : normalizeFacets({})

  // 4 — scope, then abstain
  const declared = scopeOf(row, type)
  const in_scope = declared === null ? !isEmptyFacets(facets) : declared

  // Out-of-scope rows carry no facets — "not neurotech" and "neurotech we
  // failed to classify" must stay distinguishable.
  if (!in_scope) {
    return { facet_function: [], facet_access: [], facet_application: [], in_scope: false, classifier_version: CLASSIFIER_VERSION }
  }
  return {
    facet_function: facets.function,
    facet_access: facets.access,
    facet_application: facets.application,
    in_scope: true,
    classifier_version: CLASSIFIER_VERSION,
  }
}

export { MESH_FACETS }
