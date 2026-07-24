/**
 * data.js — unified data layer
 * Uses Supabase when VITE_SUPABASE_URL is configured; falls back to static JSON.
 */
import { supabase } from './supabase'
import papersJson from '../data/papers.json'
import devicesJson from '../data/devices.json'
import organizationsJson from '../data/organizations.json'
import researchersJson from '../data/researchers.json'

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
export async function searchPapers({ query = '', facets = {}, recency = null, yearRange = null, source = null, sort = 'relevant', page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  const term = query.trim()
  const minYear = recencyMinYear(recency)
  const base = () => {
    // `estimated` count, not `exact`: an exact count over the ~55k in-scope
    // papers exceeds the statement timeout. The planner estimate is instant and
    // fine for a browse-index header and pagination.
    let b = supabase
      .from('papers')
      .select(`title,authors,journal,year,doi,url,abstract,pubmed_id,${FACET_COLS}`, { count: 'estimated' })
    if (term) b = b.textSearch('fts', term, { type: 'websearch' })
    b = applyFacets(b, facets)
    b = applyYear(b, yearRange, 'year')
    if (source) b = b.eq('source', source)                 // 'pubmed' (papers) | 'arxiv' (preprints)
    if (minYear) b = b.gte('year', String(minYear))        // year is 4-digit text → lexical compare is safe
    return b.range(page * pageSize, page * pageSize + pageSize - 1)
  }
  // Default: OpenAlex field-normalized impact, then year. 'newest' sorts by year.
  // Falls back to year order if rank_score isn't in the table yet.
  const ordered = sort === 'newest'
    ? base().order('year', { ascending: false })
    : base().order('rank_score', { ascending: false }).order('year', { ascending: false })
  let { data, count, error } = await ordered
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
  // Default: importance score (phase/status/enrollment) then recency. 'newest'
  // sorts purely by start date.
  if (sort === 'newest') q = q.order('published_at', { ascending: false, nullsFirst: false })
  else q = q.order('relevance_score', { ascending: false }).order('published_at', { ascending: false, nullsFirst: false })
  q = q.range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) { console.warn('searchTrials error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'trials' })), total: count ?? 0 }
}

/** A single paper by PubMed id (for its detail page). */
export async function getPaperByPmid(pmid) {
  if (!supabase || !pmid) return null
  const { data, error } = await supabase.from('papers').select('*').eq('pubmed_id', pmid).maybeSingle()
  if (error) { console.warn('getPaperByPmid error:', error.message); return null }
  return data || null
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
