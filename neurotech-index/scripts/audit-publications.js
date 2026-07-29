/**
 * audit-publications.js — second-pass audit of the precomputed company
 * publications in public/company-analytics/. For each company Claude checks:
 *   (a) is the company itself a neurotechnology company? and
 *   (b) are all listed papers genuinely its OWN neurotech research output?
 * Non-neurotech companies are cleared; off-domain / misattributed papers are
 * removed. This catches cases the first-pass judge accepts as correctly-
 * attributed but that don't belong in a neurotech DB (e.g. an organ-regeneration
 * company whose papers are genuinely its own but have nothing to do with neuro).
 *
 *   node --env-file=.env scripts/audit-publications.js --dry   # report only
 *   node --env-file=.env scripts/audit-publications.js         # apply fixes
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dir, '../public/company-analytics')
const DRY = process.argv.includes('--dry')
const MODEL = 'claude-haiku-4-5-20251001'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function auditOne(name, items) {
  const list = items.map(i => `[${i.pmid}] "${i.title}" — ${i.journal || 'n/a'}, ${i.year || 'n/a'}`).join('\n')
  const prompt = `You are auditing a NEUROTECHNOLOGY company database. Neurotechnology = devices or software that interface with, measure, stimulate, image, or modulate the nervous system (brain, peripheral nerves, spinal cord): brain-computer interfaces, EEG/MEG/neuroimaging, neuromodulation/neurostimulation, neuroprosthetics, neuro-diagnostics, neurorehabilitation, and digital neuro/mental-health.

Company: ${name}
Its listed "official publications":
${list}

Return ONLY JSON: {"isNeurotech": true|false, "wrong": ["pmid", ...]}.
- isNeurotech: false if this company is not a neurotechnology company.
- wrong: pmids that are NOT genuinely this specific company's own neurotech research output — i.e. misattributed, led by another institution, or off the neurotechnology domain. If the company is not neurotech, list all pmids.`
  const r = await anthropic.messages.create({ model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
  const m = r.content[0]?.text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in audit response')
  const j = JSON.parse(m[0])
  return { isNeurotech: j.isNeurotech !== false, wrong: new Set((j.wrong || []).map(String)) }
}

async function run() {
  const files = readdirSync(OUT).filter(f => f.endsWith('.json') && f !== '_checked.json')
  let clearedCompanies = 0, removedPapers = 0, trimmedCompanies = 0, errs = 0
  const report = []
  for (const f of files) {
    const path = join(OUT, f)
    const d = JSON.parse(readFileSync(path, 'utf8'))
    const items = d.publications?.items || []
    if (!items.length) continue
    let a
    try { a = await auditOne(d.name, items) } catch (e) { console.warn(`  ! ${d.name}: ${e.message}`); errs++; await sleep(300); continue }
    await sleep(250)

    if (!a.isNeurotech) {
      report.push(`CLEAR  ${d.name} (not neurotech) — removing ${items.length} paper(s)`)
      clearedCompanies++; removedPapers += items.length
      if (!DRY) unlinkSync(path)
      continue
    }
    const kept = items.filter(i => !a.wrong.has(String(i.pmid)))
    if (kept.length === items.length) continue
    const dropped = items.length - kept.length
    removedPapers += dropped
    if (kept.length === 0) {
      report.push(`CLEAR  ${d.name} — all ${items.length} paper(s) off-domain/misattributed`)
      clearedCompanies++
      if (!DRY) unlinkSync(path)
    } else {
      report.push(`TRIM   ${d.name} — ${items.length} → ${kept.length} (dropped ${dropped})`)
      trimmedCompanies++
      if (!DRY) writeFileSync(path, JSON.stringify({ ...d, publications: { total: kept.length, items: kept } }))
    }
  }
  console.log('\n' + report.sort().join('\n'))
  console.log(`\n${DRY ? '[DRY] ' : ''}Audit: cleared ${clearedCompanies} non-neurotech companies, trimmed ${trimmedCompanies}, removed ${removedPapers} papers total (${errs} audit errors).`)
}

run().catch(e => { console.error(e); process.exit(1) })
