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

// ── Clinical trials (table added in Phase 1; safe no-op until then) ──────────

export async function getTrials() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('clinical_trials')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data) return [] // table may not exist yet — fail soft
  return tag('trials')(data)
}

// ── News feed ───────────────────────────────────────────────────────────────

export async function getNewsFeed({ topic = null, limit = 10 } = {}) {
  if (!supabase) return []
  let q = supabase.from('news_feed').select('*').limit(200)
  if (topic) q = q.contains('topics', [topic])

  const { data, error } = await q
  if (error) { console.warn('news_feed fetch error:', error.message); return [] }

  // Order by the composite rank (relevance + engagement + recency) written by
  // refresh.js. Fall back to the raw AI score for any legacy rows.
  const rank = r => (r.metadata?.rankScore ?? (r.relevance_score ?? 0) / 10)
  return (data || []).sort((a, b) => rank(b) - rank(a)).slice(0, limit)
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
