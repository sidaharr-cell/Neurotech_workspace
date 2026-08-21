/**
 * apply-enrichment.js — fold the web-research batches into the research overlay.
 *
 *   node scripts/apply-enrichment.js          # dry run, reports only
 *   node scripts/apply-enrichment.js --commit # writes src/data/company-research.json
 *
 * WHY A FILE AND NOT THE DATABASE
 *
 * The organizations table holds ONE funding slot (total_raised_usd and its
 * confidence). 203 companies have a figure there that came from an SEC filing,
 * and that figure is the one the Form D table on the page adds up to. Writing a
 * press-reported number into that slot would either overwrite a filing-verified
 * figure or make the two indistinguishable, and on 29 July 2026 this project
 * already lost 205 funding totals to a write that looked safe.
 *
 * So the research layer lives beside the database rather than inside it: the
 * filing figure stays the headline and the press figure is shown next to it,
 * labelled. The overlay is version-controlled, so every number a reader sees is
 * reviewable in a diff, and reverting is one git operation rather than a
 * restore.
 *
 * Nothing here is written without a source URL. A record that cannot cite is
 * dropped and counted in the rejection report, because an uncited number on
 * this site is a defect, not a gap.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dir, '../scratch/enrich/out')
const VOUT_DIR = resolve(__dir, '../scratch/enrich/vout')
const COMPANIES = resolve(__dir, '../scratch/enrich/companies.json')
const IMAGES = resolve(__dir, '../scratch/enrich/images.json')
const TARGET = resolve(__dir, '../src/data/company-research.json')
const REPORT = resolve(__dir, '../scratch/enrich/apply-report.json')
const COMMIT = process.argv.includes('--commit')

const CONF = new Set(['high', 'medium', 'low'])
// A neurotech company has not raised fifty billion dollars, and a "total" under
// ten thousand is a parse error rather than a seed round. Both ends are guards
// against a misread figure reaching the page, not judgements about the company.
const MIN_USD = 10_000
const MAX_USD = 50_000_000_000

const isUrl = u => typeof u === 'string' && /^https?:\/\/\S+$/.test(u) && !/linkedin\.com/i.test(u)
const clean = s => (typeof s === 'string' && s.trim() ? s.trim() : null)

const known = new Map(
  JSON.parse(readFileSync(COMPANIES, 'utf8')).map(c => [c.id, c])
)

const rejects = []
const reject = (id, name, field, why) => rejects.push({ id, name, field, why })

function takeFunding(rec, org) {
  const f = rec.funding
  if (!f || typeof f !== 'object') return null
  const out = {}

  const num = (v, field) => {
    if (v == null) return null
    const n = Number(v)
    if (!Number.isFinite(n) || n < MIN_USD || n > MAX_USD) {
      reject(rec.id, rec.name, field, `figure out of range: ${v}`)
      return null
    }
    return Math.round(n)
  }

  const total = num(f.total_raised_usd, 'funding.total')
  if (total != null) {
    if (!isUrl(f.total_source_url)) reject(rec.id, rec.name, 'funding.total', 'no usable source url')
    else if (!CONF.has(f.total_confidence)) reject(rec.id, rec.name, 'funding.total', `bad confidence: ${f.total_confidence}`)
    else {
      out.totalUsd = total
      out.totalSourceUrl = f.total_source_url
      out.totalConfidence = f.total_confidence
      // What the database already holds, so the page can say plainly when the
      // two disagree instead of silently showing the larger one.
      out.filingUsd = org?.total_raised_usd ?? null
      out.filingVerified = org?.total_raised_confidence === 'filing_verified'
    }
  }

  const latest = num(f.latest_raise_usd, 'funding.latest')
  if (latest != null) {
    if (!isUrl(f.latest_source_url)) reject(rec.id, rec.name, 'funding.latest', 'no usable source url')
    else if (!CONF.has(f.latest_confidence)) reject(rec.id, rec.name, 'funding.latest', `bad confidence: ${f.latest_confidence}`)
    else {
      out.latestUsd = latest
      out.latestSourceUrl = f.latest_source_url
      out.latestConfidence = f.latest_confidence
      out.latestDate = clean(f.latest_raise_date)
      out.latestRound = clean(f.latest_raise_round)
    }
  }

  const note = clean(f.note)
  if (note) out.note = note
  const cur = clean(f.currency_note)
  if (cur) out.currencyNote = cur

  return Object.keys(out).length ? out : null
}

function takePeople(rec) {
  if (!Array.isArray(rec.people)) return null
  const out = []
  for (const p of rec.people) {
    const name = clean(p?.name)
    const role = clean(p?.role)
    if (!name || !role) { reject(rec.id, rec.name, 'people', `incomplete entry: ${JSON.stringify(p).slice(0, 80)}`); continue }
    if (!isUrl(p.source_url)) { reject(rec.id, rec.name, `people/${name}`, 'no usable source url (or LinkedIn)'); continue }
    // A stale title is worse than no title: it tells a reader something false
    // about who runs the company today. Founders are exempt, since founding is
    // historical and stays true after a departure.
    const isFounder = /founder/i.test(role)
    if (p.current === false && !isFounder) { reject(rec.id, rec.name, `people/${name}`, 'role not confirmed current'); continue }
    out.push({ name, role, sourceUrl: p.source_url, ...(clean(p.note) ? { note: clean(p.note) } : {}) })
  }
  return out.length ? out.slice(0, 8) : null
}

function takeStatus(rec) {
  const s = rec.status
  if (!s || typeof s !== 'object') return null
  const st = clean(s.status)
  if (!st || !['active', 'acquired', 'defunct', 'merged', 'unknown'].includes(st)) return null
  // "active" is the assumption already, so recording it changes nothing on the
  // page. Only a departure from it is worth carrying.
  if (st === 'active' || st === 'unknown') return null
  if (!isUrl(s.source_url)) { reject(rec.id, rec.name, 'status', 'no usable source url'); return null }
  return {
    status: st,
    sourceUrl: s.source_url,
    ...(clean(s.acquirer) ? { acquirer: clean(s.acquirer) } : {}),
    ...(clean(s.event_date) ? { eventDate: clean(s.event_date) } : {}),
    confidence: CONF.has(s.confidence) ? s.confidence : 'low',
  }
}

// ── Read every batch ────────────────────────────────────────────────────────
const files = existsSync(OUT_DIR)
  ? readdirSync(OUT_DIR).filter(f => /^batch-\d+\.json$/.test(f)).sort()
  : []

const companies = {}
let seen = 0, unknownId = 0, parseFail = []
const dupes = new Set()

for (const file of files) {
  let rows
  try { rows = JSON.parse(readFileSync(join(OUT_DIR, file), 'utf8')) }
  catch (e) { parseFail.push({ file, error: e.message }); continue }
  if (!Array.isArray(rows)) { parseFail.push({ file, error: 'not an array' }); continue }

  for (const rec of rows) {
    if (!rec?.id) continue
    seen++
    const org = known.get(rec.id)
    if (!org) { unknownId++; reject(rec.id, rec.name, 'id', 'no such company in the export'); continue }
    if (companies[rec.id]) dupes.add(rec.id)

    const funding = takeFunding(rec, org)
    const people = takePeople(rec)
    const status = takeStatus(rec)
    const aka = Array.isArray(rec.also_known_as)
      ? rec.also_known_as.map(clean).filter(Boolean).filter(a => a.toLowerCase() !== org.name.toLowerCase()).slice(0, 5)
      : []
    // Flags are free-form, so they bypass the per-field URL guard. They still
    // must not carry a LinkedIn link: a checker legitimately REPORTS that a
    // company's only web presence is a LinkedIn page, and the report is worth
    // keeping, but the link is not, because the rule is about what this file
    // publishes and not only about what a fact was read from.
    const scrubLinkedIn = v => {
      if (typeof v === 'string') return /linkedin\.com/i.test(v) && /^https?:\/\//.test(v.trim()) ? null : v
      if (Array.isArray(v)) return v.map(scrubLinkedIn).filter(x => x != null)
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, scrubLinkedIn(x)]).filter(([, x]) => x != null)
        )
      }
      return v
    }
    const flags = Array.isArray(rec.flags)
      ? rec.flags.map(scrubLinkedIn).filter(f => f && (typeof f !== 'object' || Object.keys(f).length)).slice(0, 5)
      : []
    const desc = clean(rec.description_suggestion)

    if (!funding && !people && !status && !aka.length && !flags.length) continue

    companies[rec.id] = {
      name: org.name,
      ...(funding ? { funding } : {}),
      ...(people ? { people } : {}),
      ...(status ? { status } : {}),
      ...(aka.length ? { alsoKnownAs: aka } : {}),
      ...(flags.length ? { flags } : {}),
      // Held but not rendered: a suggested description is a person's call, not
      // a pipeline's. It sits here so it can be reviewed in the diff.
      ...(desc ? { descriptionSuggestion: desc } : {}),
    }
  }
}

// ── Link verification ───────────────────────────────────────────────────────
/**
 * Records a check against the primary source said do not belong to this
 * company, as a SUPPRESSION rather than a delete.
 *
 * The edge could be deleted from the relationships table instead. It is not,
 * for the same reason the funding figure is not overwritten: a delete leaves no
 * trace of what was removed or why, and this project's write invariant exists
 * because a nightly job once deleted rows it believed it owned. A suppression
 * list is reviewable in a diff, carries the reason and the source beside every
 * entry, and is undone by deleting a line.
 *
 * `uncertain` verdicts are deliberately NOT suppressed. A record a checker could
 * not reach is left on the page where a reader can see it and judge it.
 */
const vfiles = existsSync(VOUT_DIR)
  ? readdirSync(VOUT_DIR).filter(f => /^vbatch-\d+\.json$/.test(f)).sort()
  : []

const removals = []
let checked = 0, verdicts = { keep: 0, remove: 0, uncertain: 0 }

for (const file of vfiles) {
  let rows
  try { rows = JSON.parse(readFileSync(join(VOUT_DIR, file), 'utf8')) }
  catch (e) { parseFail.push({ file, error: e.message }); continue }
  if (!Array.isArray(rows)) { parseFail.push({ file, error: 'not an array' }); continue }

  for (const rec of rows) {
    const org = known.get(rec?.id)
    if (!org) continue
    checked++
    const sup = { trials: [], devices: [], publications: [] }

    const walk = (list, key, idOf) => {
      for (const item of Array.isArray(list) ? list : []) {
        const v = clean(item?.verdict)
        if (!v || !(v in verdicts)) continue
        verdicts[v]++
        if (v !== 'remove') continue
        const ident = idOf(item)
        if (!ident) continue
        sup[key].push(ident)
        removals.push({
          company: org.name, kind: key, id: ident,
          why: clean(item.why) || 'no reason given',
          belongsTo: clean(item.belongs_to) || null,
          sourceUrl: isUrl(item.source_url) ? item.source_url : null,
        })
      }
    }
    walk(rec.trials, 'trials', i => clean(i.nct))
    walk(rec.devices, 'devices', i => clean(i.name))
    walk(rec.publications, 'publications', i => (i.pmid != null ? String(i.pmid) : null))

    if (sup.trials.length || sup.devices.length || sup.publications.length) {
      companies[rec.id] = companies[rec.id] || { name: org.name }
      companies[rec.id].suppress = Object.fromEntries(
        Object.entries(sup).filter(([, v]) => v.length)
      )
    }
  }
}

// ── Higher-resolution pictures ──────────────────────────────────────────────
/**
 * A picture large enough to run at the full measure, from the company's own
 * og:image, found by scripts/upgrade-company-images.js.
 *
 * The stored picture for most companies is an apple-touch-icon, which the
 * company page now renders as a small mark rather than enlarging. Where a site
 * publishes a real picture of itself this replaces that mark, so the page gets
 * a hero it can show at size without upscaling.
 *
 * Dimensions are carried, because the page's decision to run a picture large
 * depends on them and a picture with no measurements is treated as a mark.
 */
let upgradedImages = 0
if (existsSync(IMAGES)) {
  const imgs = JSON.parse(readFileSync(IMAGES, 'utf8'))
  for (const [id, im] of Object.entries(imgs)) {
    const org = known.get(id)
    if (!org || !isUrl(im?.url) || !im.w || !im.h) continue
    // Same bars the page applies, enforced here too so a picture that cannot be
    // shown large, or cannot survive a 16:9 crop, never reaches the overlay.
    if (Math.max(im.w, im.h) < 900 || Math.min(im.w, im.h) < 500) continue
    const ratio = im.w / im.h
    if (ratio > 3 || ratio < 1 / 3) continue
    companies[id] = companies[id] || { name: org.name }
    companies[id].image = {
      url: im.url, w: im.w, h: im.h,
      kind: im.kind || 'photo', subject: im.subject || 'item',
      credit: clean(im.credit), source: im.source || 'site-og',
      sourceUrl: isUrl(im.sourceUrl) ? im.sourceUrl : null,
    }
    upgradedImages++
  }
}

const withFunding = Object.values(companies).filter(c => c.funding).length
const withTotal = Object.values(companies).filter(c => c.funding?.totalUsd).length
const withPeople = Object.values(companies).filter(c => c.people).length
const peopleCount = Object.values(companies).reduce((n, c) => n + (c.people?.length || 0), 0)
const withStatus = Object.values(companies).filter(c => c.status).length
const conflicts = Object.values(companies).filter(c => c.funding?.filingVerified && c.funding?.totalUsd && c.funding.totalUsd !== c.funding.filingUsd)

const payload = {
  _note: 'Web-researched overlay for company pages. Sourced by search, not by the '
    + 'ingest pipeline, so every field carries the URL it was read from and a '
    + 'confidence. The database stays the primary-source layer: where a company has '
    + 'an SEC filing-verified total, that figure remains the headline on the page '
    + 'and the reported total here is shown beside it. Regenerate with '
    + 'scripts/apply-enrichment.js --commit.',
  _generated: new Date().toISOString().slice(0, 10),
  _counts: { companies: Object.keys(companies).length, withTotal, withPeople, peopleCount, withStatus },
  companies,
}

console.log(`batches read      ${files.length}`)
console.log(`records seen      ${seen}`)
console.log(`companies kept    ${Object.keys(companies).length}`)
console.log(`  funding          ${withFunding} (${withTotal} with a total)`)
console.log(`  people           ${withPeople} companies, ${peopleCount} people`)
console.log(`  status change    ${withStatus}`)
console.log(`filing conflicts  ${conflicts.length} (press total differs from the SEC figure)`)
console.log(`rejected fields   ${rejects.length}`)
console.log(`hi-res images     ${upgradedImages}`)
console.log(`\nlink checks       ${vfiles.length} batches, ${checked} companies`)
console.log(`  keep             ${verdicts.keep}`)
console.log(`  remove           ${verdicts.remove}  -> suppressed`)
console.log(`  uncertain        ${verdicts.uncertain}  -> left on the page`)
if (unknownId) console.log(`unknown ids       ${unknownId}`)
if (dupes.size) console.log(`duplicate ids     ${dupes.size} (last one wins)`)
if (parseFail.length) console.log(`UNPARSEABLE FILES ${parseFail.length}: ${parseFail.map(p => p.file).join(', ')}`)

writeFileSync(REPORT, JSON.stringify({ rejects, parseFail, removals, conflicts: conflicts.map(c => ({ name: c.name, press: c.funding.totalUsd, filing: c.funding.filingUsd })), dupes: [...dupes] }, null, 1))
console.log(`\nreport -> ${REPORT}`)

if (COMMIT) {
  writeFileSync(TARGET, JSON.stringify(payload, null, 1) + '\n')
  console.log(`WROTE  -> ${TARGET}`)
} else {
  console.log('\nDry run. Nothing written. Re-run with --commit to write the overlay.')
}
