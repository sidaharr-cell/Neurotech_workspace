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
export async function searchPapers({ query = '', deviceClass = null, page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  let q = supabase
    .from('papers')
    .select('title,authors,journal,year,doi,url,abstract,tags,pubmed_id', { count: 'exact' })
  const term = query.trim()
  if (term) q = q.textSearch('fts', term, { type: 'websearch' })
  if (deviceClass) q = q.contains('tags', [deviceClass])
  q = q.order('year', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1)

  const { data, count, error } = await q
  if (error) { console.warn('searchPapers error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'papers' })), total: count ?? 0 }
}

/** Server-side paginated search over research labs (organizations, type='lab'). */
export async function searchLabs({ query = '', deviceClass = null, page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  let q = supabase.from('organizations').select('*', { count: 'exact' }).eq('type', 'lab')
  const term = query.trim().replace(/[(),%]/g, ' ')
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
  if (deviceClass) q = q.contains('focus_areas', [deviceClass])
  q = q.order('name').range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) { console.warn('searchLabs error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'organizations' })), total: count ?? 0 }
}

/** Server-side paginated search over the full devices table. */
export async function searchDevices({ query = '', deviceClass = null, page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  let q = supabase.from('devices').select('*', { count: 'exact' })
  const term = query.trim().replace(/[(),%]/g, ' ')
  if (term) q = q.or(`name.ilike.%${term}%,manufacturer.ilike.%${term}%`)
  if (deviceClass) q = q.contains('tags', [deviceClass])
  q = q.order('year', { ascending: false, nullsFirst: false }).range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) { console.warn('searchDevices error:', error.message); return { rows: [], total: 0 } }
  return { rows: (data || []).map(r => ({ ...r, _type: 'devices' })), total: count ?? 0 }
}

/** Server-side paginated search over clinical trials (stored in news_feed). */
export async function searchTrials({ query = '', deviceClass = null, page = 0, pageSize = 20 } = {}) {
  if (!supabase) return { rows: [], total: 0 }
  let q = supabase.from('news_feed').select('*', { count: 'exact' }).eq('entry_type', 'trial')
  if (query.trim()) q = q.ilike('title', `%${query.trim()}%`)
  if (deviceClass) q = q.contains('topics', [deviceClass])
  q = q.order('published_at', { ascending: false, nullsFirst: false }).range(page * pageSize, page * pageSize + pageSize - 1)
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
  }
}
