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

/** Every record's inclusion_basis is defended against this text. */
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

/**
 * The column stores the enum. These are the words a reader sees, and they are
 * display-only: renaming one is not a migration.
 *
 * `digital_therapeutic` reads as "Prescription therapy" rather than "Digital
 * therapeutic". The stored name is the industry term, and it names the delivery
 * medium while leaving out the part that decides membership: every company in
 * it sells a prescription treatment cleared for a neurological or psychiatric
 * indication. It is also not all software. Freespira is a breathing sensor,
 * Otoharmonics is sound, MedRhythms is auditory stimulation with a wearable.
 */
export const MODALITY_LABELS = {
  implanted_bci: 'Implanted BCI',
  neuromodulation: 'Neuromodulation',
  diagnostics_imaging: 'Diagnostics and imaging',
  digital_therapeutic: 'Prescription therapy',
  computational_neuro: 'Computational neuroscience',
  other: 'Other',
}

/**
 * What a stored modality shows as on the funding figures.
 *
 * `digital_therapeutic` is a real value and stays one: it is in the CHECK
 * constraint on `organizations.modality` in migration 008, and seven companies
 * carry it in scripts/data/inclusion-basis.json. It is folded into `other` for
 * DISPLAY only, because seven companies did not earn a fifth chip on a filter
 * row that has to fit one line beside a chart, and `other` is defined as in
 * scope but not in one of the named groups — which is what they are.
 *
 * The fold happens once, where the board is built, so every reader of a board
 * row sees the same answer and no surface has to remember to apply it. Nothing
 * is written back, and undoing it is deleting one entry.
 */
export const MODALITY_FOLD = { digital_therapeutic: 'other' }
export const foldModality = m => (m ? MODALITY_FOLD[m] || m : null)

/** One plain sentence per modality, carried on the filter controls, because a
 *  two-word label cannot say where its boundary falls. */
export const MODALITY_DESCRIPTIONS = {
  implanted_bci: 'Brain-computer interfaces placed inside the skull.',
  neuromodulation: 'Devices that stimulate nerves or brain tissue, implanted or worn.',
  diagnostics_imaging: 'Hardware and software that measures or images the nervous system.',
  digital_therapeutic: 'Prescription treatments delivered through software or sensory stimulus, '
    + 'cleared for a neurological or psychiatric indication. Not implanted, and not always software.',
  computational_neuro: 'Modelling and analysis of neural data.',
  other: 'In scope by the inclusion rule but not in one of the named groups. '
    + 'Includes prescription therapies: treatments delivered through software or '
    + 'sensory stimulus, cleared for a neurological or psychiatric indication.',
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
 * The stage ladder is two ladders.
 *
 * `first_in_human` → `feasibility` → `pivotal` is progress through clinical
 * evidence. `de_novo_granted` → `cleared_510k` → `approved_pma` is a market
 * authorisation. stage_rank() orders them in one sequence, which a range filter
 * needs, but they are different routes: a cleared 510(k) device is not a later
 * stage of a pivotal trial, it is a different regulatory path taken by a
 * different kind of product.
 *
 * Plotting them on one axis manufactures a trend. 510(k) is the cheaper route,
 * so it is crowded with smaller companies, and putting it above `pivotal`
 * produces a negative capital-versus-maturity correlation that is an artifact of
 * the axis and not a fact about neurotech. Measured 29 Jul 2026: rho = -0.21
 * across all 45 records, but +0.35 within the clinical path alone.
 *
 * So the scatter bands them and never compares across the divide.
 */
export const STAGE_BANDS = [
  { id: 'clinical', label: 'Clinical evidence', stages: ['first_in_human', 'feasibility', 'pivotal'] },
  { id: 'regulatory', label: 'FDA authorisation', stages: ['de_novo_granted', 'cleared_510k', 'approved_pma'] },
]

/**
 * Company age, in three bands.
 *
 * Banded rather than continuous, and that is what makes it usable at all. Form D
 * asks for a year of incorporation but an issuer formed more than five years
 * before filing answers "over five years ago" and gives none, so a quarter of
 * the set has only an upper bound on the year — which is a LOWER bound on the
 * age. A continuous scale cannot draw "at least 22 years old". A band can,
 * whenever the minimum age already lands in the top band.
 *
 * Measured 15 Aug 2026 on the 45 companies the scatter plots: 29 declare a year
 * and 9 of the 16 bounds place, so 38 of 45 carry a band against 29 that would
 * carry a continuous size. The genuinely unplaceable ones are `null`, and the
 * figure marks them rather than defaulting them into the middle.
 *
 * The age itself comes from a FOUNDING year where one is known and falls back to
 * incorporation otherwise — see ageBand. The two are different facts and the
 * founding one is what "how old is this company" asks; incorporation can trail
 * it by years or reset entirely. See docs/founded-backfill-scope.md.
 */
export const AGE_BANDS = [
  { id: 'young', label: 'Under 7 years', maxAge: 6 },
  { id: 'mid', label: '7 to 12 years', maxAge: 12 },
  { id: 'old', label: 'Over 12 years', maxAge: Infinity },
]

const bandForAge = age => AGE_BANDS.find(b => age <= b.maxAge)?.id ?? 'old'

/**
 * Which band a company falls in, or null when the evidence cannot say.
 *
 * A bound places a company only when its MINIMUM age already falls in the top
 * band: "at least 22 years" is unambiguously "over 12", while "at least 8" is
 * consistent with two different bands and resolves to null rather than guessing
 * the nearer one.
 */
export function ageBand(row, currentYear) {
  if (!row) return null
  // A founding year first: it is what "how old is this company" actually asks,
  // and incorporation can trail it by years or reset entirely on a
  // redomiciliation. Axonics incorporated in 2012 and began operating in 2013;
  // Saluda's filing reads 2023 for a company that long predates it.
  if (row.foundedYear) return bandForAge(currentYear - row.foundedYear)
  if (row.incorporatedYear) return bandForAge(currentYear - row.incorporatedYear)
  if (row.incorporatedBefore) {
    const minAge = currentYear - row.incorporatedBefore
    return bandForAge(minAge) === 'old' ? 'old' : null
  }
  return null
}

/** Where a company's age came from, for a reader who wants to weigh it. */
export function ageBasis(row) {
  if (!row) return null
  if (row.foundedYear) return { year: row.foundedYear, kind: 'founded', sourceKind: row.foundedSourceKind, url: row.foundedSourceUrl, conflict: row.foundedConflict }
  if (row.incorporatedYear) return { year: row.incorporatedYear, kind: 'incorporated', url: row.incorporatedSourceUrl }
  if (row.incorporatedBefore) return { before: row.incorporatedBefore, kind: 'incorporated_bound', url: row.incorporatedSourceUrl }
  return null
}

/** Rows the scatter can honestly plot: a sourced total and a stage that came
 *  from a real record. A stage with no evidence is not a position on any axis. */
export function scatterPoints(rows = []) {
  const placed = new Map()
  for (const b of STAGE_BANDS) b.stages.forEach((s, i) => placed.set(s, { band: b.id, within: i }))
  return rows
    .filter(r => r.total > 0 && r.furthestStage && placed.has(r.furthestStage)
      && r.stageEvidenceType && r.stageEvidenceType !== 'none')
    .map(r => ({ ...r, ...placed.get(r.furthestStage) }))
}

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
 * The filter half of `rankFunding`, without the sort or the limit.
 *
 * Exported so a control can ask which of its own values are still reachable
 * under the *other* filters. Asking the ranked top-N instead answers a
 * different question: a modality can hold companies the top 20 by capital
 * never shows, and hiding its filter is what buries them.
 */
export function filterFunding(rows, {
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
  return rows.filter(r => statusOk(r) && modalityOk(r) && stageOk(r))
}

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
  let set = filterFunding(rows, { statuses, modalities, stageMin, stageMax })

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

/** Added by migration 018. Layered on 009 the same way and for the same reason:
 *  the chart keeps working on a database where neither has been applied. */
const COLUMNS_018 =
  `${COLUMNS_009},incorporated_year,incorporated_before_year,incorporated_source_url`

/** Migrations 019 and 021: a sourced FOUNDING year, which is a different fact
 *  from incorporation and the better one for company age. */
const COLUMNS_019 = `${COLUMNS_018},founded_year,founded_source_kind,founded_source_url,`
  + 'founded_evidence,founded_conflict'

async function selectFundedOrgs() {
  const query = cols => supabase.from('organizations').select(cols)
    .eq('type', 'company')
    .not('total_raised_usd', 'is', null)
    .not('inclusion_basis', 'is', null)
    .order('total_raised_usd', { ascending: false })
    .limit(500)
  const res = await query(COLUMNS_019)
  if (!res.error) return res
  if (/founded_(year|conflict|evidence|source)/.test(res.error.message)) {
    const r18 = await query(COLUMNS_018)
    if (!r18.error) return r18
    res.error = r18.error
  }
  // Fall back one migration at a time, so a database with 009 but not 018 keeps
  // its partial-total marks instead of losing them alongside the ages.
  if (/incorporated_/.test(res.error.message)) {
    const r9 = await query(COLUMNS_009)
    if (!r9.error) return r9
    if (/was_publicly_traded/.test(r9.error.message)) return query(COLUMNS)
    return r9
  }
  if (/was_publicly_traded/.test(res.error.message)) return query(COLUMNS)
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
    modality: foldModality(o.modality),
    inclusionBasis: o.inclusion_basis || null,
    furthestStage: o.furthest_stage || null,
    stageEvidenceType: o.stage_evidence_type || null,
    stageEvidenceId: o.stage_evidence_id || null,
    stageEvidenceUrl: stageEvidenceUrl(o.stage_evidence_type, o.stage_evidence_id),
    // Migration 018. Exactly one of these is ever set; `incorporatedBefore` is
    // an upper bound on the year, so a LOWER bound on the company's age.
    incorporatedYear: o.incorporated_year ?? null,
    incorporatedBefore: o.incorporated_before_year ?? null,
    incorporatedSourceUrl: o.incorporated_source_url ?? null,
    // Migrations 019/021. A founding year is the better answer for age and is
    // preferred over incorporation wherever it exists; see ageBand.
    foundedYear: o.founded_year ?? null,
    foundedSourceKind: o.founded_source_kind ?? null,
    foundedSourceUrl: o.founded_source_url ?? null,
    foundedEvidence: o.founded_evidence ?? null,
    foundedConflict: o.founded_conflict ?? null,
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
