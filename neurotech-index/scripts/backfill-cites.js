/**
 * backfill-cites.js — derive the paper->paper `cites` graph from OpenAlex
 * (Phase 1 relationship, left empty until now). Requires migration 003.
 *   node --env-file=.env scripts/backfill-cites.js
 *
 * High confidence and intra-DB only. For every paper with a DOI we fetch its
 * OpenAlex work (its OpenAlex id + referenced_works). A `cites` edge is created
 * only when a referenced work's OpenAlex id belongs to ANOTHER paper already in
 * our database -- so refs are matched against our own OpenAlex ids, never guessed
 * and never resolved to outside works. Idempotent (upsert on the edge's unique
 * index). Only touches the `cites` predicate; replicates/contradicts stay empty.
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const MAILTO = 'sid.a.harr@gmail.com'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shortId = u => String(u || '').split('/').pop()   // ".../W123" -> "W123"

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).'); process.exit(1)
  }

  // Pass 1: for every paper with a DOI, get its OpenAlex id and referenced_works.
  const oaToOurs = new Map()          // OpenAlex short id -> our paper id
  const paperRefs = []                // { ourId, refs: [OpenAlex short ids] }
  const byDoi = new Map()             // lowercased doi -> our paper id (for this batch join)
  let last = '00000000-0000-0000-0000-000000000000', scanned = 0, matched = 0

  async function flush(batch) {
    // batch: [{id, doi}]. Query OpenAlex for up to 50 dois at once.
    for (const b of batch) byDoi.set(b.doi.toLowerCase(), b.id)
    const filter = 'doi:' + batch.map(b => b.doi.toLowerCase()).join('|')
    const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&select=id,doi,referenced_works&per-page=50&mailto=${MAILTO}`
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url)
        if (!res.ok) { await sleep(1000 * attempt); continue }
        const { results = [] } = await res.json()
        for (const w of results) {
          const doi = (w.doi || '').replace('https://doi.org/', '').toLowerCase()
          const ourId = byDoi.get(doi)
          if (!ourId) continue
          oaToOurs.set(shortId(w.id), ourId)
          paperRefs.push({ ourId, refs: (w.referenced_works || []).map(shortId) })
          matched++
        }
        return
      } catch { await sleep(1000 * attempt) }
    }
  }

  console.log('Pass 1: fetching OpenAlex references for papers with DOIs...')
  let batch = []
  for (;;) {
    const { data, error } = await sb.from('papers').select('id,doi')
      .not('doi', 'is', null).gt('id', last).order('id').limit(1000)
    if (error) { console.warn('read error:', error.message); break }
    if (!data?.length) break
    last = data[data.length - 1].id
    for (const p of data) {
      scanned++
      batch.push(p)
      if (batch.length === 50) { await flush(batch); batch = []; await sleep(120) }
    }
    process.stdout.write(`\r  scanned ${scanned}, matched to OpenAlex ${matched}`)
    if (data.length < 1000) break
  }
  if (batch.length) await flush(batch)
  process.stdout.write('\n')

  // Pass 2: emit edges for refs that point at another paper in our DB.
  console.log('Pass 2: building intra-database citation edges...')
  const seen = new Set()
  const edges = []
  for (const { ourId, refs } of paperRefs) {
    for (const r of refs) {
      const target = oaToOurs.get(r)
      if (!target || target === ourId) continue
      const key = `${ourId}|${target}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ subject_type: 'papers', subject_id: ourId, predicate: 'cites',
        object_type: 'papers', object_id: target, confidence: 1.0, source: 'openalex',
        pipeline_version: 'derive-cites', note: 'OpenAlex referenced_works' })
    }
  }
  console.log(`  ${edges.length} cites edges among ${oaToOurs.size} matched papers.`)

  let wrote = 0
  for (let i = 0; i < edges.length; i += 500) {
    const { error } = await sb.from('relationships')
      .upsert(edges.slice(i, i + 500), { onConflict: 'subject_type,subject_id,predicate,object_type,object_id', ignoreDuplicates: true })
    if (error) { console.warn('  edge insert error:', error.message); break }
    wrote += Math.min(500, edges.length - i)
    process.stdout.write(`\r  wrote ${wrote}/${edges.length}`)
  }
  process.stdout.write('\n')
  console.log(`Done. ${wrote} cites edges written.`)
}

main().catch(err => { console.error(err); process.exit(1) })
