/**
 * fundingBoard.js — the query layer behind the funding chart (Phase 3).
 *
 * Replaces the name-keyed JSON merge in companyFunding.js as the chart's source.
 * Funding now lives in Postgres with per-figure provenance (migration 008), so
 * this module reads it, ranks it, and hands the component a payload where every
 * figure travels with the facts needed to caveat it.
 *
 * Two things this fixes beyond moving the storage.
 *
 * 1. The set is RESELECTED per sort key. The old chart fixed the set at the top
 *    20 by total raised and let the toggles reorder that fixed set, so under
 *    "Latest raise size" a company with a big recent round but a smaller
 *    lifetime total could never appear. Each sort key now selects its own top N.
 *
 * 2. A null latest raise carries its reason. `n/a` stood for five different
 *    situations; unavailableReason distinguishes them.
 */
import { supabase } from './supabase'

// ── Settled decisions (docs/neurobase-funding-chart-revision.md) ────────────
export const CAPITAL_SCOPE = 'private_only'
export const DEFAULT_SORT = 'total_raised'

/** Rendered verbatim in the chart caption. Every record's inclusion_basis is
 *  defended against this text. */
export const INCLUSION_RULE =
  'Companies whose primary product interfaces with, measures, or modulates the ' +
  'nervous system. This includes implanted and external neuromodulation devices, ' +
  'brain-computer interfaces, neurological diagnostic and imaging software, and ' +
  'prescription digital therapeutics for neurological or psychiatric indications. ' +
  'It excludes companies developing drugs for neurological indications, and ' +
  'excludes general-purpose platforms that are not specific to the nervous system.'

/**
 * The default view is "active only". The spec defines that as private plus
 * public, but 1,063 of 1,084 company rows have never had a status researched,
 * and a literal `status in (private, public)` filter would hide every one of
 * them. So the default EXCLUDES the two statuses that are positively known to
 * be inactive and admits null, which means unresearched rather than defunct.
 * Hiding a company requires evidence, exactly as asserting one does.
 */
export const HIDDEN_BY_DEFAULT = ['acquired', 'defunct']
export const STATUS_VALUES = ['private', 'public', 'acquired', 'subsidiary', 'defunct']
export const DEFAULT_STATUS_FILTER = STATUS_VALUES.filter(s => !HIDDEN_BY_DEFAULT.includes(s))

// ── Enum vocabulary and labels ──────────────────────────────────────────────
export const STATUS_LABELS = {
  private: 'Private',
  public: 'Public',
  acquired: 'Acquired',
  subsidiary: 'Subsidiary',
  defunct: 'Defunct',
}

export const MODALITY_LABELS = {
  implanted_bci: 'Implanted BCI',
  neuromodulation: 'Neuromodulation',
  diagnostics_imaging: 'Diagnostics and imaging',
  digital_therapeutic: 'Digital therapeutic',
  computational_neuro: 'Computational neuroscience',
  other: 'Other',
}

/** Ordered. Mirrors stage_rank() in supabase/migrations/008-funding.sql and
 *  STAGE_RANK in scripts/lib/stage.js. Change one, change all three. */
export const STAGE_ORDER = [
  'preclinical', 'first_in_human', 'feasibility', 'pivotal', 'de_novo_granted',
  'cleared_510k', 'approved_pma', 'ce_marked', 'commercial', 'withdrawn',
]
export const STAGE_LABELS = {
  preclinical: 'Preclinical',
  first_in_human: 'First in human',
  feasibility: 'Feasibility',
  pivotal: 'Pivotal',
  de_novo_granted: 'De Novo granted',
  cleared_510k: '510(k) cleared',
  approved_pma: 'PMA approved',
  ce_marked: 'CE marked',
  commercial: 'Commercial',
  withdrawn: 'Withdrawn',
}
export const stageRank = s => (s === 'withdrawn' ? 99 : STAGE_ORDER.indexOf(s) + 1)

/**
 * What goes in the cell where `n/a` used to be. `short` renders in the column,
 * `long` on hover. `unverified` is a work-queue state and must never reach the
 * chart, so it reads as "Not checked" rather than pretending to be a finding.
 */
export const UNAVAILABLE_REASONS = {
  no_filing_found: { short: 'None found', long: 'Searched SEC Form D filings; no round located.' },
  not_applicable_public: { short: 'Public', long: 'Publicly traded. Private rounds are not the relevant instrument.' },
  not_applicable_acquired: { short: 'Acquired', long: 'Acquired. No longer raising independently.' },
  not_applicable_defunct: { short: 'Defunct', long: 'No longer operating. Not raising.' },
  foreign_issuer_not_covered: { short: 'Non-US', long: 'Not a US issuer, so SEC Form D does not apply.' },
  unverified: { short: 'Not checked', long: 'This record has not been checked yet.' },
}

/**
 * What to render where the latest raise is absent.
 *
 * Migration 009 widened the stored enum to hold `not_applicable_defunct`, so
 * this is no longer patching over a column that could not express the truth.
 * Status still wins, for a narrower reason: it is a sourced field with its own
 * status_source_url, while the reason code is written by the ingestion run. A
 * company whose status changed since its last EDGAR check therefore reads
 * correctly here before the next sweep catches up, rather than showing a stale
 * reason for up to 21 days.
 */
export function unavailableLabel(row) {
  if (row.status === 'defunct') {
    return { short: 'Defunct', long: 'No longer operating. Not raising.' }
  }
  if (row.status === 'acquired') {
    return { short: 'Acquired', long: 'Acquired. No longer raising independently.' }
  }
  return UNAVAILABLE_REASONS[row.unavailableReason] || UNAVAILABLE_REASONS.unverified
}

export const SORTS = [
  { id: 'total_raised', label: 'Total raised', title: 'Top {n} neurotech companies by total capital raised' },
  { id: 'trailing_24mo', label: 'Last 24 months', title: 'Top {n} neurotech companies by capital raised in the last 24 months' },
  { id: 'latest_raise_size', label: 'Latest raise size', title: 'Top {n} neurotech companies by size of most recent round' },
  { id: 'latest_raise_date', label: 'Latest raise date', title: 'Neurotech companies by most recent round, newest first' },
]
export const sortTitle = (sortId, n) =>
  (SORTS.find(s => s.id === sortId) || SORTS[0]).title.replace('{n}', n)

/**
 * Modality is carried by a swatch beside the company name, not by the bar
 * colour. The bars stay the single editorial blue, because six hues across the
 * plot area weakens the card the spec says to preserve. Every hue is dark
 * enough to hold 3:1 against both paper and canvas, and no swatch is the only
 * carrier of its meaning: the legend names it and the row's accessible name
 * states it.
 */
export const MODALITY_COLOR = {
  implanted_bci: '#0B5FA6',
  neuromodulation: '#2E7D8F',
  diagnostics_imaging: '#5B5AA8',
  digital_therapeutic: '#9C5A2C',
  computational_neuro: '#4A6B32',
  other: '#6B7280',
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Whole US dollars in, an editorial figure out. */
export const fmtUsd = usd => {
  if (!usd) return null
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`
  if (usd >= 1e6) return `$${Math.round(usd / 1e6)}M`
  return `$${(usd / 1e3).toFixed(0)}K`
}

/** "Jun 2025". The old "Jun 25" read as a day of the month. */
export const fmtMonthYear = d =>
  (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US',
    { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

/** Rendered in the reader's own timezone. Ingestion timestamps are UTC, and a
 *  run that finishes late evening in the Americas is already tomorrow in UTC;
 *  printing that raw makes the caption claim the data was updated in the
 *  future. */
export const fmtDay = d =>
  (d ? new Date(d).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown')

// ── Evidence links ──────────────────────────────────────────────────────────
/** A stage badge is only worth showing if you can click through to the record
 *  behind it. Returns null when the evidence id is not a linkable identifier. */
export function stageEvidenceUrl(type, id) {
  if (!id) return null
  if (/^https?:\/\//.test(id)) return id
  if (type === 'clinicaltrials_gov') return `https://clinicaltrials.gov/study/${id}`
  if (type === 'openfda') {
    return /^P/i.test(id)
      ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?num=${id}`
      : `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${id}`
  }
  return null
}

// ── Ranking (pure, so it can be tested without a database) ──────────────────

const MS_PER_DAY = 864e5
export const trailingCutoff = (now = Date.now(), months = 24) =>
  new Date(now - months * 30.44 * MS_PER_DAY).toISOString().slice(0, 10)

/**
 * Sum each organization's rounds inside the trailing window.
 * Rounds with no date or no amount cannot be placed in a window, so they are
 * not counted; a company whose only round is undated reads as "no qualifying
 * round" rather than as zero.
 */
export function trailingTotals(rounds = [], cutoff = trailingCutoff()) {
  const byOrg = {}
  for (const r of rounds) {
    if (!r.round_date || !r.amount_usd) continue
    if (r.round_date < cutoff) continue
    byOrg[r.organization_id] = (byOrg[r.organization_id] || 0) + r.amount_usd
  }
  return byOrg
}

const desc = key => (a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity)

/**
 * Filter, sort, reselect, and rank.
 *
 * `trailing_24mo` sorts companies with no qualifying round LAST rather than as
 * zero, so they surface only when fewer than `limit` companies raised in the
 * window. The component renders them without a bar, because a zero-length bar
 * on a capital chart reads as "raised nothing", which is a different claim from
 * "raised nothing in this window".
 */
export function rankFunding(rows, {
  sort = DEFAULT_SORT,
  limit = 20,
  statuses = DEFAULT_STATUS_FILTER,
  modalities = null,
  stageMin = null,
  stageMax = null,
} = {}) {
  const statusOk = r => !statuses || r.status == null || statuses.includes(r.status)
  const modalityOk = r => !modalities?.length || modalities.includes(r.modality)
  const stageOk = r => {
    if (stageMin == null && stageMax == null) return true
    if (!r.furthestStage) return false
    const rank = stageRank(r.furthestStage)
    return (stageMin == null || rank >= stageRank(stageMin))
        && (stageMax == null || rank <= stageRank(stageMax))
  }

  let set = rows.filter(r => statusOk(r) && modalityOk(r) && stageOk(r))

  if (sort === 'total_raised') {
    set = set.filter(r => r.total > 0).sort(desc('total'))
  } else if (sort === 'trailing_24mo') {
    // Qualifying rounds first, in descending order; the rest keep their
    // total-raised order behind them.
    const qualifying = set.filter(r => r.trailing > 0).sort(desc('trailing'))
    const rest = set.filter(r => !r.trailing).sort(desc('total'))
    set = [...qualifying, ...rest]
  } else if (sort === 'latest_raise_size') {
    set = set.filter(r => r.latestAmount > 0).sort(desc('latestAmount'))
  } else if (sort === 'latest_raise_date') {
    set = set.filter(r => r.latestDate).sort((a, b) => (a.latestDate < b.latestDate ? 1 : -1))
  }

  return set.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }))
}

// ── Fetch ───────────────────────────────────────────────────────────────────

const COLUMNS = [
  'id', 'name', 'display_name', 'status', 'capital_scope', 'modality', 'modality_secondary',
  'inclusion_basis', 'total_raised_usd', 'total_raised_source_url', 'total_raised_confidence',
  'total_raised_retrieved_at', 'latest_raise_usd', 'latest_raise_date', 'latest_raise_source_url',
  'latest_raise_unavailable_reason', 'latest_raise_confidence', 'furthest_stage',
  'stage_evidence_type', 'stage_evidence_id', 'last_verified_at',
].join(',')

/** Added by migration 009. Requested separately so the chart keeps working on a
 *  database where that migration has not been applied yet, and starts using the
 *  column the moment it has, with no redeploy. */
const COLUMNS_009 = `${COLUMNS},was_publicly_traded`

async function selectFundedOrgs() {
  const query = cols => supabase.from('organizations').select(cols)
    .eq('type', 'company')
    .not('total_raised_usd', 'is', null)
    .not('inclusion_basis', 'is', null)
    .order('total_raised_usd', { ascending: false })
    .limit(500)
  const res = await query(COLUMNS_009)
  if (res.error && /was_publicly_traded/.test(res.error.message)) return query(COLUMNS)
  return res
}

/** DB row → the shape the chart renders. Dollars stay whole; the component
 *  formats. A private-only total on a public or acquired company is a PARTIAL
 *  total, and the row says so rather than leaving the reader to assume. */
export function toRow(o, trailing = 0) {
  const reason = o.latest_raise_usd ? null : (o.latest_raise_unavailable_reason || 'unverified')
  return {
    id: o.id,
    name: o.display_name || o.name,
    href: `/company/${o.id}`,
    total: o.total_raised_usd || 0,
    totalSourceUrl: o.total_raised_source_url || null,
    totalConfidence: o.total_raised_confidence || 'unverified',
    capitalScope: o.capital_scope || CAPITAL_SCOPE,
    // A private-only total is partial whenever the company also raised on the
    // public markets. Public and acquired companies always did. A DEFUNCT one
    // only did if it listed before it died, which is a fact and not an
    // inference: Pear Therapeutics listed through a SPAC, while a startup that
    // quietly folded has a complete private total. was_publicly_traded is null
    // until migration 009 adds it, and null is not false.
    partialTotal: (o.capital_scope || CAPITAL_SCOPE) === 'private_only'
      && (o.status === 'public' || o.status === 'acquired'
        || (o.status === 'defunct' && o.was_publicly_traded === true)),
    trailing,
    latestAmount: o.latest_raise_usd || 0,
    latestDate: o.latest_raise_date || null,
    latestSourceUrl: o.latest_raise_source_url || null,
    unavailableReason: reason,
    status: o.status || null,
    modality: o.modality || null,
    inclusionBasis: o.inclusion_basis || null,
    furthestStage: o.furthest_stage || null,
    stageEvidenceType: o.stage_evidence_type || null,
    stageEvidenceId: o.stage_evidence_id || null,
    stageEvidenceUrl: stageEvidenceUrl(o.stage_evidence_type, o.stage_evidence_id),
    lastVerifiedAt: o.last_verified_at || null,
  }
}

/**
 * The funded set plus the metadata the caption needs.
 * Returns { rows, meta } with rows unranked; call rankFunding to select a view.
 * Returns null when Supabase is not configured, which the component treats as
 * "no chart" rather than falling back to unsourced JSON.
 */
export async function getFundingBoard() {
  if (!supabase) return null

  const [orgsRes, roundsRes, countRes] = await Promise.all([
    // inclusion_basis is the gate. A company with a sourced figure but no
    // written basis is not charted, which is also how the excluded companies in
    // scripts/data/inclusion-basis.json stay off: they are marked with a reason
    // and given no basis rather than deleted, so the fact that they were
    // considered survives.
    selectFundedOrgs(),
    supabase.from('funding_rounds')
      .select('organization_id,amount_usd,round_date')
      .gte('round_date', trailingCutoff())
      .limit(5000),
    supabase.from('organizations').select('id', { count: 'exact', head: true }).eq('type', 'company'),
  ])

  if (orgsRes.error || !orgsRes.data?.length) return null

  const trailing = trailingTotals(roundsRes.data || [])
  const rows = orgsRes.data.map(o => toRow(o, trailing[o.id] || 0))

  const lastIngestedAt = orgsRes.data
    .map(o => o.total_raised_retrieved_at).filter(Boolean).sort().pop() || null

  return {
    rows,
    meta: {
      organizationsTracked: countRes.count ?? null,
      fundedCount: rows.length,   // sourced figure AND a written inclusion basis
      inclusionRule: INCLUSION_RULE,
      capitalScope: CAPITAL_SCOPE,
      lastIngestedAt,
      hiddenByDefault: rows.filter(r => HIDDEN_BY_DEFAULT.includes(r.status)).length,
    },
  }
}
