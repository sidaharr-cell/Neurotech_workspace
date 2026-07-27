/**
 * data.js — unified data layer
 * Uses Supabase when VITE_SUPABASE_URL is configured; falls back to static JSON.
 */
import { supabase } from './supabase'
import papersJson from '../data/papers.json'
import devicesJson from '../data/devices.json'
import organizationsJson from '../data/organizations.json'
import researchersJson from '../data/researchers.json'
import { getFunding } from './companyFunding'
import { FUNCTION, ACCESS, APPLICATION } from './facets'

function tag(type) {
  return items => items.map(i => ({ ...i, _type: type }))
}

// ── Filter helpers ────────────────────────────────────────────────────────────
// Recency presets → an ISO cutoff (for date-backed tables: feed, trials) or a
// minimum year (for tables that only store a year: papers, devices).
export function recencyCutoffISO(r) {
  const d = new Date()
  if (r === 'week') d.setDate(d.getDate() - 7)
  else if (r === 'month') d.setMonth(d.getMonth() - 1)
  else if (r === 'year') d.setFullYear(d.getFullYear() - 1)
  else return null
  return d.toISOString()
}
export function recencyMinYear(r) {
  const y = new Date().getFullYear()
  if (r === 'y1') return y
  if (r === 'y3') return y - 2
  if (r === 'y10') return y - 9
  return null
}
// Trial UI status → the raw ClinicalTrials.gov status values it covers.
const TRIAL_STATUS_MAP = {
  recruiting: ['RECRUITING', 'ENROLLING_BY_INVITATION'],
  active: ['ACTIVE_NOT_RECRUITING'],
  completed: ['COMPLETED'],
  notyet: ['NOT_YET_RECRUITING'],
}

/**
 * Apply the three-facet filter and the scope gate to a query.
 * `facets` is { function, access, application }, each an ARRAY of selected
 * values (empty = no filter). Semantics match a checkbox panel: OR within a
 * facet (any selected value), AND across facets. The columns are Postgres
 * text[], so `.overlaps` takes a JS array and tests set intersection.
 * Out-of-scope rows are hidden unless `includeOutOfScope` is set.
 */
const arr = v => (Array.isArray(v) ? v : v ? [v] : [])
function applyFacets(q, facets = {}, includeOutOfScope = false) {
  if (!includeOutOfScope) q = q.eq('in_scope', true)
  const fn = arr(facets.function), ax = arr(facets.access), ap = arr(facets.application)
  if (fn.length) q = q.overlaps('facet_function', fn)
  if (ax.length) q = q.overlaps('facet_access', ax)
  if (ap.length) q = q.overlaps('facet_application', ap)
  return q
}

// Facet columns every card needs to render its badges.
const FACET_COLS = 'facet_function,facet_access,facet_application,in_scope'

// ── Per-facet-value result counts (Phase 4) ─────────────────────────────────
const FACET_DIMS = { function: FUNCTION, access: ACCESS, application: APPLICATION }
const FACET_COL = { function: 'facet_function', access: 'facet_access', application: 'facet_application' }
// Only the lean tables get live per-value counts. The papers and patents tables
// are fat (a facet-filtered count already times out on them, see the year
// histogram note), so counting ~23 values would be slow and flaky there; the
// sidebar simply shows no counts and hides nothing in that case.
const COUNTABLE_TABLES = new Set(['devices', 'organizations'])

/**
 * For each value of each facet dimension, count in-scope rows that would match
 * if that value were selected, holding the OTHER dimensions' current selections
 * fixed (standard faceted counts, so a user sees what adding a value yields).
 * Returns { function:{value:n}, access:{...}, application:{...} } or null when
 * the table is not countable or any count fails (the UI then hides counts).
 * `extraFilter(q)` applies a page-specific constraint (for example org type).
 */
export async function facetCounts({ table = 'devices', facets = {}, extraFilter = null } = {}) {
  if (!supabase || !COUNTABLE_TABLES.has(table)) return null
  const sel = k => arr(facets[k])
  const out = { function: {}, access: {}, application: {} }
  const tasks = []
  for (const dim of Object.keys(FACET_DIMS)) {
    for (const val of FACET_DIMS[dim]) {
      if (val === 'none' || val === 'not_applicable') continue
      tasks.push((async () => {
        let q = supabase.from(table).select('*', { count: 'exact', head: true }).eq('in_scope', true)
        for (const other of Object.keys(FACET_COL)) {
          if (other === dim) continue        // count this dimension's values freely
          const s = sel(other)
          if (s.length) q = q.overlaps(FACET_COL[other], s)
        }
        if (extraFilter) q = extraFilter(q)
        q = q.overlaps(FACET_COL[dim], [val])
        const { count, error } = await q
        if (error) throw error
        out[dim][val] = count ?? 0
      })())
    }
  }
  try { await Promise.all(tasks) } catch { return null }
  return out
}

/**
 * Apply a histogram year selection to a query. `range` is { lo, hi } (a click
 * on a year bar; lo null = the "before N" bucket). `dateCol` is the 4-digit
 * text 'year' column, or a date/timestamp column compared against Jan-1 bounds.
 */
function applyYear(q, range, dateCol = 'year') {
  if (!range) return q
  const { lo, hi } = range
  if (dateCol === 'year') {
    if (lo != null) q = q.gte('year', String(lo))
    q = q.lt('year', String(hi))
  } else {
    if (lo != null) q = q.gte(dateCol, `${lo}-01-01`)
    q = q.lt(dateCol, `${hi}-01-01`)
  }
  return q
}

/**
 * "Results by year" histogram for the sidebar. One grouped query via the
 * `year_histogram` RPC — fast and exact thanks to the (in_scope, <year>)
 * covering index (migration 002). Reflects the scope gate and facet filters,
 * but not the free-text search box.
 *
 * `table` is papers | devices | patents | news_feed; the RPC reads the right
 * date column for each. Returns [{ label, n }] oldest→newest with a leading
 * "before N" bucket, or [] on error — e.g. a facet-filtered query over the fat
 * papers table can still exceed the timeout, in which case the histogram hides.
 */
const asArr = v => (Array.isArray(v) ? v : v ? [v] : [])

export async function yearHistogram({ table = 'papers', facets = {}, from = 2010 } = {}) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('year_histogram', {
    p_table: table,
    p_fn: asArr(facets.function),
    p_ax: asArr(facets.access),
    p_ap: asArr(facets.application),
  })
  if (error || !data) return []

  // The RPC returns the year as text (some rows are dirty/empty) — parse to a
  // 4-digit int and drop anything that isn't one.
  const now = new Date().getFullYear()
  const byYear = new Map()
  for (const r of data) {
    const m = /\d{4}/.exec(r.yr || '')
    if (!m) continue
    const y = +m[0]
    if (y < 1900 || y > now + 1) continue
    byYear.set(y, (byYear.get(y) || 0) + Number(r.n))
  }
  // Each bucket carries its [lo, hi) year range so a click can filter results.
  let before = 0
  for (const [yr, n] of byYear) if (yr < from) before += n
  const out = [{ label: `<${from}`, n: before, lo: null, hi: from }]
  for (let y = from; y <= now; y++) out.push({ label: String(y), n: byYear.get(y) || 0, lo: y, hi: y + 1 })
  return out
}

// ── Database entries ────────────────────────────────────────────────────────

export async function getPapers() {
  if (!supabase) return tag('papers')(papersJson)
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error || !data?.length) return tag('papers')(papersJson)
  return tag('papers')(data.map(normalizeSupabasePaper))
}

export async function getDevices() {
  if (!supabase) return tag('devices')(devicesJson)
  const { data, error } = await supabase
    .from('devices')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data?.length) return tag('devices')(devicesJson)
  return tag('devices')(data.map(normalizeSupabaseDevice))
}

export async function getOrganizations() {
  if (!supabase) return tag('organizations')(organizationsJson)
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data?.length) return tag('organizations')(organizationsJson)
  return tag('organizations')(data.map(normalizeSupabaseOrg))
}

export async function getResearchers() {
  if (!supabase) return tag('researchers')(researchersJson)
  const { data, error } = await supabase
    .from('researchers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data?.length) return tag('researchers')(researchersJson)
  return tag('researchers')(data.map(normalizeSupabaseResearcher))
}

// ── Entry counts (for the hero stats) ───────────────────────────────────────

/**
 * Real row counts per entity type. Uses Supabase's exact count (no rows
 * transferred); falls back to the seed JSON lengths when Supabase is absent or
 * a count fails, so the hero always shows something sensible.
 */
export async function getCounts() {
  const fallback = {
    papers: papersJson.length,
    devices: devicesJson.length,
    organizations: organizationsJson.length,
    researchers: researchersJson.length,
  }
  if (!supabase) return fallback

  const tables = ['papers', 'devices', 'organizations', 'researchers']
  const counts = {}
  await Promise.all(tables.map(async t => {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
    counts[t] = error || count == null ? fallback[t] : count
  }))
  return counts
}

// ── Clinical trials (table added in Phase 1; safe no-op until then) ──────────

export async function getTrials() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('news_feed')
    .select('*')
    .eq('entry_type', 'trial')
    .limit(200)
  if (error || !data) return []
  const rank = r => r.metadata?.rankScore ?? 0
  return data.sort((a, b) => rank(b) - rank(a)).map(r => ({ ...r, _type: 'trials' }))
}

// ── News feed ───────────────────────────────────────────────────────────────

export async function getNewsFeed({ entryTypes = null, limit = 60 } = {}) {
  if (!supabase) return []
  // Exclude trials at the query level — there are thousands of them and they
  // have their own page; otherwise they'd crowd out the news items.
  const { data, error } = await supabase.from('news_feed').select('*').neq('entry_type', 'trial').limit(400)
  if (error) { console.warn('news_feed fetch error:', error.message); return [] }

  let rows = data || []
  if (entryTypes) rows = rows.filter(r => entryTypes.includes(r.entry_type))

  // Order by the composite rank (relevance + engagement + recency) written by
  // refresh.js. Fall back to the raw AI score for any legacy rows.
  const rank = r => (r.metadata?.rankScore ?? (r.relevance_score ?? 0) / 10)
  const sorted = rows.sort((a, b) => rank(b) - rank(a))
  const top = sorted.slice(0, limit)
  // Always surface real-image stories (they rank below papers) so the feed has
  // photos to feature; the UI decides how many to actually show.
  const inTop = new Set(top)
  const realExtra = sorted.slice(limit).filter(r => r.metadata?.imageKind === 'real' && !inTop.has(r))
  return [...top, ...realExtra]
}

/**
 * Server-side paginated + full-text search over the full papers table.
 * Uses the `fts` tsvector index; filters by derived device-class `tags`.
 */
// Whether the dedup column (migration 006) exists. Assume yes; if a query fails
// on it, flip to false so we stop filtering on it until the migration is applied.
let dedupReady = true

export async function searchPapers({ query = '', facets = {}, recency = null, yearRange = null, source = null, sort = 'relevant', page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  const term = query.trim()
  const minYear = recencyMinYear(recency)
  const base = () => {
    // `estimated` count, not `exact`: an exact count over the ~55k in-scope
    // papers exceeds the statement timeout. The planner estimate is instant and
    // fine for a browse-index header and pagination.
    // code_urls/data_urls are NOT selected here on purpose: they are a paper-page
    // feature and, being added by migration 005, selecting them explicitly would
    // error the whole query until that migration is applied. The detail page uses
    // select('*'), which safely omits them until the column exists.
    let b = supabase
      .from('papers')
      .select(`id,title,authors,journal,year,doi,url,abstract,pubmed_id,source,${FACET_COLS}`, { count: 'estimated' })
    if (term) b = b.textSearch('fts', term, { type: 'websearch' })
    b = applyFacets(b, facets)
    b = applyYear(b, yearRange, 'year')
    if (source) b = b.eq('source', source)                 // 'pubmed' (papers) | 'arxiv' (preprints)
    if (minYear) b = b.gte('year', String(minYear))        // year is 4-digit text → lexical compare is safe
    if (dedupReady) b = b.is('canonical_id', null)         // hide merged duplicate versions (Phase 6)
    return b.range(page * pageSize, page * pageSize + pageSize - 1)
  }
  // Default: OpenAlex field-normalized impact, then year. 'newest' sorts by year.
  // Falls back to year order if rank_score isn't in the table yet.
  const ordered = sort === 'newest'
    ? base().order('year', { ascending: false })
    : base().order('rank_score', { ascending: false }).order('year', { ascending: false })
  let { data, count, error } = await ordered
  // Pre-migration fallbacks: retry without whichever column is missing.
  if (error && /canonical_id/.test(error.message)) {
    dedupReady = false
    ;({ data, count, error } = await base().order(sort === 'newest' ? 'year' : 'rank_score', { ascending: false }))
  }
  if (error && /rank_score/.test(error.message)) {
    ({ data, count, error } = await base().order('year', { ascending: false }))
  }
  if (error) { console.warn('searchPapers error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'papers' })), total: count ?? 0 }
}

/** Server-side paginated search over research labs (organizations, type='lab'). */
export async function searchLabs({ query = '', facets = {}, page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  const term = query.trim().replace(/[(),%]/g, ' ')
  const base = () => {
    let b = supabase.from('organizations').select('*', { count: 'exact' }).eq('type', 'lab')
    if (term) b = b.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
    // Labs abstain (no facets) rather than being marked out of scope, so don't
    // apply the scope gate here — it would hide every unclassified lab.
    b = applyFacets(b, facets, true)
    return b.range(page * pageSize, page * pageSize + pageSize - 1)
  }
  // Rank by NIH funding/activity score (best-funded, most-active labs first),
  // then name. Falls back to name order if rank_score isn't in the table yet.
  let { data, count, error } = await base().order('rank_score', { ascending: false }).order('name')
  if (error && /rank_score/.test(error.message)) {
    ({ data, count, error } = await base().order('name'))
  }
  if (error) { console.warn('searchLabs error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'organizations' })), total: count ?? 0 }
}

/** Server-side paginated search over neurotech companies (organizations,
 *  type='company'). Funding (total + latest round) is overlaid by name from the
 *  client-side companyFunding map, so funded companies show a raised badge. */
export async function searchCompanies({ query = '', facets = {}, page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  const term = query.trim().replace(/[(),%]/g, ' ')
  const base = () => {
    let b = supabase.from('organizations').select('*', { count: 'exact' }).eq('type', 'company')
    if (term) b = b.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
    // Companies abstain (many are unclassified) — don't apply the scope gate, or
    // it would hide every company the classifier couldn't tag.
    b = applyFacets(b, facets, true)
    return b.range(page * pageSize, page * pageSize + pageSize - 1)
  }
  // rank_score puts funded companies first, then a stable quality order.
  let { data, count, error } = await base().order('rank_score', { ascending: false }).order('name')
  if (error && /rank_score/.test(error.message)) {
    ({ data, count, error } = await base().order('name'))
  }
  if (error) { console.warn('searchCompanies error:', error.message); return { rows: [], total: 0 } }
  const rows = (data || []).map(r => {
    const f = getFunding(r.name)
    return {
      ...r,
      _type: 'organizations',
      funding: f?.total ?? 0,
      latestRound: f?.latestRound ?? null,
      roundYear: f?.roundYear ?? null,
    }
  })
  return { rows, total: count ?? 0 }
}

/** One company by its (deterministic) id, with funding overlaid. */
export async function getCompanyById(id) {
  if (!supabase) return null
  const { data, error } = await supabase.from('organizations').select('*').eq('id', id).eq('type', 'company').maybeSingle()
  if (error || !data) return null
  const f = getFunding(data.name)
  return { ...data, _type: 'organizations', funding: f?.total ?? 0, latestRound: f?.latestRound ?? null, roundYear: f?.roundYear ?? null, fundingRounds: f?.rounds ?? [], fundingSource: f?.source ?? 'none' }
}

/**
 * Everything about a company that can be joined live from our own tables:
 * FDA devices (by manufacturer), patents (by assignee), neurotech clinical
 * trials (by sponsor) and news mentions. Name-matched with ILIKE; each capped.
 */
export async function getCompanyRelated(name) {
  if (!supabase || !name) return { devices: [], deviceCount: 0, patents: [], patentCount: 0, trials: [], trialCount: 0, news: [] }
  const like = `%${name.replace(/[%,()]/g, ' ').trim()}%`
  const [dev, devC, pat, patC, trials, trialC, news] = await Promise.all([
    supabase.from('devices').select('id,name,manufacturer,type,status,year,url,facet_function,facet_access,facet_application,in_scope').ilike('manufacturer', like).order('year', { ascending: false, nullsFirst: false }).limit(12),
    supabase.from('devices').select('*', { count: 'exact', head: true }).ilike('manufacturer', like),
    supabase.from('patents').select('patent_number,title,assignee,grant_date,url').ilike('assignee', like).order('grant_date', { ascending: false, nullsFirst: false }).limit(10),
    supabase.from('patents').select('*', { count: 'exact', head: true }).ilike('assignee', like),
    supabase.from('news_feed').select('id,title,url,published_at,metadata,relevance_score').eq('entry_type', 'trial').ilike('metadata->>sponsor', like).order('published_at', { ascending: false, nullsFirst: false }).limit(10),
    supabase.from('news_feed').select('*', { count: 'exact', head: true }).eq('entry_type', 'trial').ilike('metadata->>sponsor', like),
    supabase.from('news_feed').select('id,title,url,source,published_at').neq('entry_type', 'trial').or(`title.ilike.${like},summary.ilike.${like}`).order('published_at', { ascending: false, nullsFirst: false }).limit(8),
  ])
  return {
    devices: dev.data || [], deviceCount: devC.count ?? (dev.data?.length || 0),
    patents: pat.data || [], patentCount: patC.count ?? (pat.data?.length || 0),
    trials: trials.data || [], trialCount: trialC.count ?? (trials.data?.length || 0),
    news: news.data || [],
  }
}

// ── The entity graph (Phase 1 relationships) ────────────────────────────────
// These read the typed `relationships` edge table built by scripts/backfill-
// graph.js, not name matching. An edge is (subject_type, subject_id) --predicate
// --> (object_type, object_id) with a confidence and its own provenance.

const TRIAL_ACTIVE = new Set(['RECRUITING', 'ENROLLING_BY_INVITATION', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING'])
const oldest = ts => ts.filter(Boolean).sort()[0] || null

/**
 * Everything linked to one organization THROUGH THE GRAPH: devices it makes
 * (made_by), trials it sponsors (sponsored_by), the regulatory records on those
 * devices (cleared_via), and affiliated people (affiliated_with, empty until
 * that edge is derived). Each section carries the oldest last_updated of its
 * rows so the page can show per-section provenance. Sparse by design: only
 * confidently-matched edges exist, so an org with no edges yields empty sections.
 */
export async function getOrgGraph(orgId) {
  const empty = { devices: [], trials: { active: [], completed: [] }, regulatory: [], people: [],
    provenance: { devices: null, trials: null, regulatory: null } }
  if (!supabase || !orgId) return empty

  // Edges pointing AT this org.
  const { data: edges, error } = await supabase.from('relationships')
    .select('subject_type,subject_id,predicate,confidence')
    .eq('object_type', 'organizations').eq('object_id', orgId)
    .in('predicate', ['made_by', 'sponsored_by', 'affiliated_with'])
  if (error || !edges) return empty

  const deviceIds = edges.filter(e => e.predicate === 'made_by').map(e => e.subject_id)
  const trialIds = edges.filter(e => e.predicate === 'sponsored_by').map(e => e.subject_id)
  const personIds = edges.filter(e => e.predicate === 'affiliated_with').map(e => e.subject_id)

  const [devRes, trialRes, personRes] = await Promise.all([
    deviceIds.length ? supabase.from('devices')
      .select(`id,name,manufacturer,type,status,year,url,description,product_code,last_updated,source_url,${FACET_COLS}`)
      .in('id', deviceIds).order('year', { ascending: false, nullsFirst: false }) : Promise.resolve({ data: [] }),
    trialIds.length ? supabase.from('news_feed')
      .select('id,title,url,metadata,published_at,last_updated,source_url')
      .in('id', trialIds).order('published_at', { ascending: false, nullsFirst: false }) : Promise.resolve({ data: [] }),
    personIds.length ? supabase.from('researchers')
      .select('id,name,role,affiliation').in('id', personIds) : Promise.resolve({ data: [] }),
  ])
  const devices = devRes.data || []
  const trials = trialRes.data || []
  const people = personRes.data || []

  // Regulatory records hang off this org's devices (device cleared_via record).
  let regulatory = []
  if (devices.length) {
    const { data: regs } = await supabase.from('regulatory_records')
      .select('id,device_id,pathway,decision_date,number,source_url,last_updated')
      .in('device_id', devices.map(d => d.id)).order('decision_date', { ascending: false, nullsFirst: false })
    const nameById = Object.fromEntries(devices.map(d => [d.id, d.name]))
    regulatory = (regs || []).map(r => ({ ...r, device_name: nameById[r.device_id] }))
  }

  const active = [], completed = []
  for (const t of trials) (TRIAL_ACTIVE.has(t.metadata?.status) ? active : completed).push(t)

  return {
    devices, trials: { active, completed }, regulatory, people,
    provenance: {
      devices: oldest(devices.map(d => d.last_updated)),
      trials: oldest(trials.map(t => t.last_updated)),
      regulatory: oldest(regulatory.map(r => r.last_updated)),
    },
  }
}

/**
 * Graph-derived device and trial counts for a page of orgs, in two queries.
 * Returns { [orgId]: { devices, trials } }. Used by the /companies index so each
 * row's counts come from real edges, not a name match.
 */
export async function getOrgCounts(orgIds = []) {
  const out = {}
  if (!supabase || !orgIds.length) return out
  for (const id of orgIds) out[id] = { devices: 0, trials: 0 }
  const { data } = await supabase.from('relationships')
    .select('predicate,object_id')
    .eq('object_type', 'organizations').in('object_id', orgIds)
    .in('predicate', ['made_by', 'sponsored_by'])
  for (const e of data || []) {
    if (!out[e.object_id]) continue
    if (e.predicate === 'made_by') out[e.object_id].devices++
    else if (e.predicate === 'sponsored_by') out[e.object_id].trials++
  }
  return out
}

/** One device row by id, tagged for the device page. */
export async function getDeviceById(id) {
  if (!supabase || !id) return null
  const { data, error } = await supabase.from('devices').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return { ...data, _type: 'devices' }
}

/**
 * Everything linked to one device THROUGH THE GRAPH, for the device page: its
 * maker (made_by -> org), regulatory records (cleared_via), the papers that
 * evaluate it (evaluates ->) and trials that study it (studies ->), and the
 * follow-up work that cites/replicates/contradicts those papers. The paper and
 * trial edges are not derived yet, so those come back empty (honest, not
 * fabricated); the schema and this reader are ready for them.
 */
export async function getDeviceGraph(deviceId) {
  const empty = { maker: null, regulatory: [], papers: [], trials: [], relatedWork: [],
    provenance: { regulatory: null, papers: null, trials: null } }
  if (!supabase || !deviceId) return empty

  const [subj, obj] = await Promise.all([
    supabase.from('relationships').select('predicate,object_id')
      .eq('subject_type', 'devices').eq('subject_id', deviceId).in('predicate', ['made_by', 'cleared_via']),
    supabase.from('relationships').select('predicate,subject_id')
      .eq('object_type', 'devices').eq('object_id', deviceId).in('predicate', ['evaluates', 'studies']),
  ])
  const makerId = subj.data?.find(e => e.predicate === 'made_by')?.object_id || null
  const regIds = (subj.data || []).filter(e => e.predicate === 'cleared_via').map(e => e.object_id)
  const paperIds = (obj.data || []).filter(e => e.predicate === 'evaluates').map(e => e.subject_id)
  const trialIds = (obj.data || []).filter(e => e.predicate === 'studies').map(e => e.subject_id)

  const [makerRes, regRes, paperRes, trialRes] = await Promise.all([
    makerId ? supabase.from('organizations').select('id,name,type,location').eq('id', makerId).maybeSingle() : Promise.resolve({ data: null }),
    regIds.length ? supabase.from('regulatory_records').select('id,pathway,decision_date,number,source_url,last_updated').in('id', regIds).order('decision_date', { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] }),
    paperIds.length ? supabase.from('papers').select('id,title,year,journal,pubmed_id,url,rank_score,last_updated').in('id', paperIds) : Promise.resolve({ data: [] }),
    trialIds.length ? supabase.from('news_feed').select('id,title,url,metadata,published_at,last_updated').in('id', trialIds) : Promise.resolve({ data: [] }),
  ])
  const papers = paperRes.data || []

  // Follow-up literature: papers that cite/replicate/contradict the evaluating
  // papers. Only queried when there are evaluating papers (none yet).
  let relatedWork = []
  if (papers.length) {
    const { data: rel } = await supabase.from('relationships').select('predicate,subject_id,object_id')
      .in('object_id', papers.map(p => p.id)).in('predicate', ['cites', 'replicates', 'contradicts'])
    const relIds = [...new Set((rel || []).map(e => e.subject_id))]
    if (relIds.length) {
      const { data: relPapers } = await supabase.from('papers').select('id,title,year,journal,pubmed_id,url').in('id', relIds)
      const kindById = Object.fromEntries((rel || []).map(e => [e.subject_id, e.predicate]))
      relatedWork = (relPapers || []).map(p => ({ ...p, relation: kindById[p.id] }))
    }
  }

  return {
    maker: makerRes.data || null,
    regulatory: regRes.data || [],
    papers, trials: trialRes.data || [], relatedWork,
    provenance: {
      regulatory: oldest((regRes.data || []).map(r => r.last_updated)),
      papers: oldest(papers.map(p => p.last_updated)),
      trials: oldest((trialRes.data || []).map(t => t.last_updated)),
    },
  }
}

/** Precomputed analytics (publications) served as a static file; null if none. */
export async function getCompanyAnalytics(id) {
  try {
    const res = await fetch(`/company-analytics/${id}.json`)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/** Server-side paginated search over the full devices table. */
export async function searchDevices({ query = '', facets = {}, recency = null, yearRange = null, fda = null, sort = 'newest', page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  let q = supabase.from('devices').select('*', { count: 'exact' })
  const term = query.trim().replace(/[(),%]/g, ' ')
  if (term) q = q.or(`name.ilike.%${term}%,manufacturer.ilike.%${term}%`)
  q = applyFacets(q, facets)
  q = applyYear(q, yearRange, 'year')
  const minYear = recencyMinYear(recency)
  if (minYear) q = q.gte('year', String(minYear))
  if (fda === '510k') q = q.ilike('status', '%510%')
  else if (fda === 'pma') q = q.ilike('status', '%PMA%')
  q = q.order('year', { ascending: sort === 'oldest', nullsFirst: false }).range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) { console.warn('searchDevices error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'devices' })), total: count ?? 0 }
}

/** Server-side paginated + full-text search over the neurotech patents table. */
export async function searchPatents({ query = '', facets = {}, recency = null, yearRange = null, sort = 'newest', page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  // `estimated` count for the same reason as papers — the patents table is 47k rows.
  let q = supabase.from('patents').select(`patent_number,title,abstract,assignee,grant_date,cpc_codes,url,${FACET_COLS}`, { count: 'estimated' })
  const term = query.trim()
  if (term) q = q.textSearch('fts', term, { type: 'websearch' })
  q = applyFacets(q, facets)
  q = applyYear(q, yearRange, 'grant_date')
  const minYear = recencyMinYear(recency)
  if (minYear) q = q.gte('grant_date', `${minYear}-01-01`)
  q = q.order('grant_date', { ascending: sort === 'oldest', nullsFirst: false }).range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) { console.warn('searchPatents error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'patents' })), total: count ?? 0 }
}

/** Server-side paginated search over clinical trials (stored in news_feed). */
export async function searchTrials({ query = '', facets = {}, recency = null, yearRange = null, phase = null, status = null, sort = 'relevant', page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  let q = supabase.from('news_feed').select('*', { count: 'exact' }).eq('entry_type', 'trial')
  if (query.trim()) q = q.ilike('title', `%${query.trim()}%`)
  q = applyFacets(q, facets)
  q = applyYear(q, yearRange, 'published_at')
  const iso = recencyCutoffISO(recency)
  if (iso) q = q.gte('published_at', iso)
  if (phase) q = q.ilike('metadata->>phase', `%${phase}%`)          // e.g. "Phase 3" also matches "Phase 2 / Phase 3"
  if (status) q = q.in('metadata->>status', TRIAL_STATUS_MAP[status] || [status])
  // 'changed' surfaces trials whose status/phase/enrollment moved most recently
  // (metadata.lastChanged, written by scripts/trials.js). 'newest' sorts by
  // start date. Default: importance score then recency.
  if (sort === 'newest') q = q.order('published_at', { ascending: false, nullsFirst: false })
  else if (sort === 'changed') q = q.order('metadata->>lastChanged', { ascending: false, nullsFirst: false }).order('relevance_score', { ascending: false })
  else q = q.order('relevance_score', { ascending: false }).order('published_at', { ascending: false, nullsFirst: false })
  q = q.range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) { console.warn('searchTrials error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'trials' })), total: count ?? 0 }
}

/**
 * Recent trial status/phase/enrollment changes (Phase 7), newest first, each
 * with its trial title and link. Reads the trial_changes log written by
 * scripts/trials.js on each sync. Empty until a sync detects a change.
 */
export async function getRecentTrialChanges(limit = 20) {
  if (!supabase) return []
  const { data, error } = await supabase.from('trial_changes')
    .select('id,nct_id,trial_id,field,old_value,new_value,changed_at')
    .order('changed_at', { ascending: false }).limit(limit)
  if (error || !data?.length) return []
  const ids = [...new Set(data.map(c => c.trial_id).filter(Boolean))]
  const byId = {}
  if (ids.length) {
    const { data: trials } = await supabase.from('news_feed').select('id,title,url').in('id', ids)
    for (const t of trials || []) byId[t.id] = t
  }
  return data.map(c => ({ ...c, title: byId[c.trial_id]?.title || c.nct_id, url: byId[c.trial_id]?.url || null }))
}

/**
 * For a page of trials (news_feed ids), resolve each one's sponsor organization
 * via the sponsored_by edge, so a trial row can link its sponsor to the company
 * page. Returns { [trialId]: { id, name } }.
 */
export async function getTrialSponsors(trialIds = []) {
  const out = {}
  if (!supabase || !trialIds.length) return out
  const { data } = await supabase.from('relationships').select('subject_id,object_id')
    .eq('subject_type', 'news_feed').eq('predicate', 'sponsored_by').in('subject_id', trialIds)
  const orgByTrial = {}
  for (const e of data || []) orgByTrial[e.subject_id] = e.object_id
  const orgIds = [...new Set(Object.values(orgByTrial))]
  if (!orgIds.length) return out
  const { data: orgs } = await supabase.from('organizations').select('id,name').in('id', orgIds)
  const nameById = Object.fromEntries((orgs || []).map(o => [o.id, o.name]))
  for (const [tid, oid] of Object.entries(orgByTrial)) out[tid] = { id: oid, name: nameById[oid] }
  return out
}

/** Trial (news_feed) ids sponsored by any of these orgs, via the graph. */
export async function getOrgTrialIds(orgIds = []) {
  if (!supabase || !orgIds.length) return []
  const { data } = await supabase.from('relationships').select('subject_id')
    .eq('predicate', 'sponsored_by').eq('object_type', 'organizations').in('object_id', orgIds)
  return [...new Set((data || []).map(e => e.subject_id))]
}

/**
 * Changes to a set of watched trials since a timestamp (Phase 8 "what changed").
 * Reads the same trial_changes log the trials view uses; empty until a sync logs
 * a change. Returns newest-first with each trial's title and link.
 */
export async function getWatchlistChanges(trialIds = [], sinceISO = null) {
  if (!supabase || !trialIds.length) return []
  let q = supabase.from('trial_changes')
    .select('id,nct_id,trial_id,field,old_value,new_value,changed_at')
    .in('trial_id', trialIds).order('changed_at', { ascending: false }).limit(100)
  if (sinceISO) q = q.gt('changed_at', sinceISO)
  const { data, error } = await q
  if (error || !data?.length) return []
  const ids = [...new Set(data.map(c => c.trial_id).filter(Boolean))]
  const byId = {}
  if (ids.length) {
    const { data: tr } = await supabase.from('news_feed').select('id,title,url').in('id', ids)
    for (const t of tr || []) byId[t.id] = t
  }
  return data.map(c => ({ ...c, title: byId[c.trial_id]?.title || c.nct_id, url: byId[c.trial_id]?.url || null }))
}

/** A single paper by PubMed id (for its detail page). */
export async function getPaperByPmid(pmid) {
  if (!supabase || !pmid) return null
  const { data, error } = await supabase.from('papers').select('*').eq('pubmed_id', pmid).maybeSingle()
  if (error) { console.warn('getPaperByPmid error:', error.message); return null }
  return data || null
}

/**
 * Reproducibility/provenance signals for one paper (Phase 5): the later papers
 * that contradict or replicate it, read from the relationships table. Empty
 * until those edges are derived; the badges then link to the related record.
 */
export async function getPaperSignals(paperId) {
  const empty = { contradictedBy: [], replicatedBy: [] }
  if (!supabase || !paperId) return empty
  const { data } = await supabase.from('relationships')
    .select('predicate,subject_id')
    .eq('object_type', 'papers').eq('object_id', paperId)
    .in('predicate', ['contradicts', 'replicates'])
  if (!data?.length) return empty
  const ids = [...new Set(data.map(e => e.subject_id))]
  const { data: papers } = await supabase.from('papers').select('id,title,year,pubmed_id,url').in('id', ids)
  const byId = Object.fromEntries((papers || []).map(p => [p.id, p]))
  const contradictedBy = [], replicatedBy = []
  for (const e of data) {
    const p = byId[e.subject_id]
    if (p) (e.predicate === 'contradicts' ? contradictedBy : replicatedBy).push(p)
  }
  return { contradictedBy, replicatedBy }
}

/**
 * Batched contradiction/replication flags for a page of papers, one query.
 * Returns { [paperId]: { contradicted, replicated } } for the paper rows.
 */
export async function getPaperSignalsBatch(paperIds = []) {
  const out = {}
  if (!supabase || !paperIds.length) return out
  const { data } = await supabase.from('relationships')
    .select('predicate,object_id')
    .eq('object_type', 'papers').in('object_id', paperIds)
    .in('predicate', ['contradicts', 'replicates'])
  for (const e of data || []) {
    out[e.object_id] = out[e.object_id] || {}
    if (e.predicate === 'contradicts') out[e.object_id].contradicted = true
    else out[e.object_id].replicated = true
  }
  return out
}

/** A single feed item by id (for the internal detail page). */
export async function getNewsItem(id) {
  if (!supabase || !id) return null
  const { data, error } = await supabase.from('news_feed').select('*').eq('id', id).maybeSingle()
  if (error) { console.warn('news_item fetch error:', error.message); return null }
  return data || null
}

// ── Normalizers (snake_case DB → camelCase app) ─────────────────────────────

// Every normalizer passes the stored facets through unchanged, so cards read
// them straight off the row instead of recomputing anything in the browser.
const facetsOf = r => ({
  facet_function: r.facet_function || [],
  facet_access: r.facet_access || [],
  facet_application: r.facet_application || [],
  in_scope: r.in_scope,
})

function normalizeSupabasePaper(p) {
  return {
    title: p.title,
    authors: p.authors || [],
    journal: p.journal,
    year: p.year,
    doi: p.doi,
    url: p.url,
    abstract: p.abstract,
    tags: p.tags || [],
    pubmedId: p.pubmed_id,
    arxivId: p.arxiv_id,
    source: p.source,
    ...facetsOf(p),
  }
}

function normalizeSupabaseDevice(d) {
  return {
    name: d.name,
    manufacturer: d.manufacturer,
    type: d.type,
    year: d.year,
    status: d.status,
    signalType: d.signal_type,
    channels: d.channels,
    description: d.description,
    modality: d.modality || [],
    tags: d.tags || [],
    url: d.url,
    ...facetsOf(d),
  }
}

function normalizeSupabaseOrg(o) {
  return {
    name: o.name,
    type: o.type,
    location: o.location,
    founded: o.founded,
    description: o.description,
    focusAreas: o.focus_areas || [],
    website: o.website,
    founders: o.founders || [],
    ...facetsOf(o),
  }
}

function normalizeSupabaseResearcher(r) {
  return {
    name: r.name,
    affiliation: r.affiliation,
    role: r.role,
    bio: r.bio,
    expertise: r.expertise || [],
    notableWork: r.notable_work || [],
    ...facetsOf(r),
  }
}
