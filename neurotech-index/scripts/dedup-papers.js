/**
 * dedup-papers.js — collapse arXiv/bioRxiv/published versions of one paper into
 * a single canonical record with a version history (Phase 6). Requires migration
 * 006. Conservative, and every merge is logged so it can be reversed.
 *   node --env-file=.env scripts/dedup-papers.js          # apply
 *   node --env-file=.env scripts/dedup-papers.js --dry     # report only, no write
 *   node --env-file=.env scripts/dedup-papers.js --revert <log.json>
 *
 * Clustering (all in src/lib/dedup.js, the one auditable place): group by
 * normalized title, then within a group merge records whose author surnames
 * overlap enough (or that share a DOI). Below threshold, records stay separate --
 * a false merge hides a real paper, which is worse than a visible duplicate.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync } from 'node:fs'
import { normTitle, sameWork, chooseCanonical, versionOf } from '../src/lib/dedup.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const DRY = process.argv.includes('--dry')

async function upsertChunk(rows) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await sb.from('papers').upsert(rows, { onConflict: 'id' })
    if (!error) return true
    if (!/timeout/i.test(error.message) || attempt === 4) { console.warn('\n  upsert error:', error.message); return false }
    await sleep(500 * attempt)
  }
  return false
}
async function writeAll(rows) {
  let ok = 0
  for (let i = 0; i < rows.length; i += 50) if (await upsertChunk(rows.slice(i, i + 50))) ok += Math.min(50, rows.length - i)
  return ok
}

async function loadAllPapers() {
  const out = []
  let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await sb.from('papers')
      .select('id,title,authors,doi,pubmed_id,arxiv_id,source,journal,year,url,canonical_id')
      .gt('id', last).order('id').limit(1000)
    if (error) { console.warn('read error:', error.message); break }
    if (!data?.length) break
    out.push(...data)
    last = data[data.length - 1].id
    process.stdout.write(`\r  loaded ${out.length} papers`)
    if (data.length < 1000) break
  }
  process.stdout.write('\n')
  return out
}

// Cluster a group of same-normalized-title papers via union-find over sameWork.
function clusterGroup(group) {
  const parent = group.map((_, i) => i)
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++)
      if (sameWork(group[i], group[j])) parent[find(i)] = find(j)
  const clusters = new Map()
  group.forEach((p, i) => { const r = find(i); (clusters.get(r) || clusters.set(r, []).get(r)).push(p) })
  return [...clusters.values()].filter(c => c.length > 1)
}

async function revert(logPath) {
  const log = JSON.parse(readFileSync(logPath, 'utf8'))
  const updates = []
  for (const m of log.merges) {
    for (const id of m.merged_ids) updates.push({ id, canonical_id: null })
    updates.push({ id: m.canonical_id, versions: [] })
  }
  // echo title is not needed for revert of existing rows via update-only upsert
  // on the primary key, but include it to satisfy NOT NULL on the insert path.
  const withTitle = updates.map(u => ({ ...u, title: log.titleById?.[u.id] }))
  const n = await writeAll(withTitle)
  console.log(`Reverted ${log.merges.length} merges (${n} row writes).`)
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).'); process.exit(1)
  }
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx !== -1) return revert(process.argv[revertIdx + 1])

  console.log('Loading papers...')
  const papers = await loadAllPapers()

  // Group by normalized title.
  const byTitle = new Map()
  for (const p of papers) {
    const k = normTitle(p.title)
    if (!k) continue
    ;(byTitle.get(k) || byTitle.set(k, []).get(k)).push(p)
  }

  const merges = []
  const canonicalUpdates = []   // { id, title, versions }
  const mergedUpdates = []      // { id, title, canonical_id }
  const titleById = {}
  for (const group of byTitle.values()) {
    if (group.length < 2) continue
    for (const cluster of clusterGroup(group)) {
      const canonical = chooseCanonical(cluster)
      const versions = cluster.map(versionOf)
        .sort((a, b) => (b.peer_reviewed - a.peer_reviewed) || String(b.year || '').localeCompare(String(a.year || '')))
      const mergedIds = cluster.filter(p => p.id !== canonical.id).map(p => p.id)
      canonicalUpdates.push({ id: canonical.id, title: canonical.title, versions })
      for (const p of cluster) if (p.id !== canonical.id) {
        mergedUpdates.push({ id: p.id, title: p.title, canonical_id: canonical.id })
        titleById[p.id] = p.title
      }
      titleById[canonical.id] = canonical.title
      merges.push({ canonical_id: canonical.id, canonical_title: canonical.title, merged_ids: mergedIds })
    }
  }

  console.log(`Found ${merges.length} clusters to merge, hiding ${mergedUpdates.length} duplicate rows.`)
  const logPath = `dedup-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(logPath, JSON.stringify({ ranAt: new Date().toISOString(), merges, titleById }, null, 2))
  console.log(`Merge log written to ${logPath} (reversible with --revert ${logPath}).`)

  if (DRY) { console.log('Dry run: no writes.'); return }
  const w1 = await writeAll(canonicalUpdates)
  const w2 = await writeAll(mergedUpdates)
  console.log(`Done. Wrote ${w1} canonical version-lists and hid ${w2} duplicate rows.`)
}

main().catch(err => { console.error(err); process.exit(1) })
