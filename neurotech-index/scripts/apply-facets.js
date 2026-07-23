/**
 * apply-facets.js — run the classifier over the database and write the facet
 * columns. This is the "classify once at ingest" pass for rows that are
 * already stored; new rows get classified by the ingest scripts themselves.
 *
 *   node --env-file=.env scripts/apply-facets.js                # every table
 *   node --env-file=.env scripts/apply-facets.js papers devices # named tables
 *   node --env-file=.env scripts/apply-facets.js --dry          # report, write nothing
 *
 * Idempotent and resumable: re-running produces identical results, and rows
 * already stamped with the current classifier_version are skipped unless
 * --force is passed.
 */
import { createClient } from '@supabase/supabase-js'
import { classify, CLASSIFIER_VERSION } from '../src/lib/classify.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const DRY = process.argv.includes('--dry')
const FORCE = process.argv.includes('--force')

const SOURCES = {
  papers: { table: 'papers' },
  patents: { table: 'patents' },
  devices: { table: 'devices' },
  trials: { table: 'news_feed', eq: ['entry_type', 'trial'] },
  news: { table: 'news_feed', neq: ['entry_type', 'trial'] },
  organizations: { table: 'organizations' },
  researchers: { table: 'researchers' },
}

const named = process.argv.slice(2).filter(a => !a.startsWith('--'))
const targets = named.length ? named : Object.keys(SOURCES)

const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())

for (const type of targets) {
  const src = SOURCES[type]
  if (!src) { console.error(`unknown source: ${type}`); continue }

  const stats = { seen: 0, changed: 0, written: 0, inScope: 0, blank: 0 }
  const fnTally = {}, axTally = {}, appTally = {}

  // Keyset pagination, not OFFSET. A deep .range() into 83k rows takes seconds
  // and eventually trips the statement timeout — and because the loop treated
  // that error as end-of-table, an earlier run silently stopped at 19,500 of
  // 83,823 papers. Seeking on the indexed primary key is constant time.
  let cursor = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    let q = sb.from(src.table).select('*').gt('id', cursor).order('id').limit(500)
    if (src.eq) q = q.eq(...src.eq)
    if (src.neq) q = q.neq(...src.neq)
    const { data, error } = await q
    if (error) { console.error(`\n${type}: ${error.message} — stopping early`); process.exitCode = 1; break }
    if (!data?.length) break
    cursor = data[data.length - 1].id

    const updates = []
    for (const row of data) {
      stats.seen++
      if (!FORCE && row.classifier_version === CLASSIFIER_VERSION) continue
      const p = classify(row, type)
      if (p.in_scope) stats.inScope++
      if (p.in_scope && !p.facet_function.length) stats.blank++
      p.facet_function.forEach(v => { fnTally[v] = (fnTally[v] || 0) + 1 })
      p.facet_access.forEach(v => { axTally[v] = (axTally[v] || 0) + 1 })
      p.facet_application.forEach(v => { appTally[v] = (appTally[v] || 0) + 1 })

      const unchanged = row.classifier_version === p.classifier_version
        && row.in_scope === p.in_scope
        && same(row.facet_function, p.facet_function)
        && same(row.facet_access, p.facet_access)
        && same(row.facet_application, p.facet_application)
      if (unchanged) continue
      stats.changed++
      updates.push({ id: row.id, ...p })
    }

    if (!DRY && updates.length) {
      for (let i = 0; i < updates.length; i += 25) {
        await Promise.all(updates.slice(i, i + 25).map(async u => {
          const { id, ...fields } = u
          const { error: e } = await sb.from(src.table).update(fields).eq('id', id)
          if (!e) stats.written++
        }))
      }
    }
    process.stdout.write(`\r  ${type}: ${stats.seen} seen · ${stats.changed} changed · ${stats.written} written`)
    if (data.length < 500) break
  }

  const pct = n => (stats.seen ? `${(100 * n / stats.seen).toFixed(0)}%` : '—')
  console.log(`\r  ${type}: ${stats.seen} rows · in scope ${stats.inScope} (${pct(stats.inScope)}) · ${DRY ? 'would write' : 'wrote'} ${DRY ? stats.changed : stats.written}`)
  const top = t => Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'
  console.log(`     function:    ${top(fnTally)}`)
  console.log(`     access:      ${top(axTally)}`)
  console.log(`     application: ${top(appTally)}`)
  if (stats.blank) console.log(`     abstained on ${stats.blank} in-scope rows (no function value)`)
}

console.log(`\n${DRY ? 'dry run — nothing written' : `✓ classifier ${CLASSIFIER_VERSION} applied`}`)
