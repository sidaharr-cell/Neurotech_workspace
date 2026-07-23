/**
 * backfill-mesh.js — fetch MeSH subject headings for every paper.
 *
 * Every PubMed record carries subject headings assigned by trained NLM
 * indexers ("Brain-Computer Interfaces", "Deep Brain Stimulation",
 * "Electroencephalography"). They are the highest-quality classification
 * signal available for the papers table and are currently not fetched at all,
 * even though the efetch response already contains them.
 *
 *   node --env-file=.env scripts/backfill-mesh.js --dry     # fetch + print, no writes
 *   node --env-file=.env scripts/backfill-mesh.js           # full backfill (resumable)
 *   node --env-file=.env scripts/backfill-mesh.js --tally   # frequency table for mapping
 *
 * REQUIRES a `mesh` column (see supabase/schema.sql):
 *   alter table papers add column if not exists mesh jsonb default '[]';
 *   create index if not exists papers_mesh_gin on papers using gin(mesh);
 *
 * Resumable: rows that already have MeSH are skipped, so it can be re-run.
 */
import { createClient } from '@supabase/supabase-js'
import { parseStringPromise } from 'xml2js'
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const UA = 'Mozilla/5.0 (compatible; NeuroBaseBot/1.0)'
const API_KEY = process.env.NCBI_API_KEY || ''
const keyParam = API_KEY ? `&api_key=${API_KEY}` : ''
const PACE = API_KEY ? 130 : 360      // ms between calls — NCBI allows 10/s with a key, 3/s without
const BATCH = 200                      // PMIDs per efetch request

const DRY = process.argv.includes('--dry')
const TALLY = process.argv.includes('--tally')
const LOAD = process.argv.includes('--load')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Fetched MeSH is cached to disk as NDJSON so the (slow) network pass can run
// before the `mesh` column exists. `--load` then pushes the cache into the
// database, which is fast. Both passes are resumable.
const CACHE = join(HERE, '../mesh-cache.ndjson')

async function hasMeshColumn() {
  const { error } = await sb.from('papers').select('mesh').limit(1)
  return !error
}

/** pmid -> headings, from the on-disk cache. */
function readCache() {
  if (!existsSync(CACHE)) return {}
  const out = {}
  for (const line of readFileSync(CACHE, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const r = JSON.parse(line); out[r.pmid] = r.mesh } catch { /* partial last line */ }
  }
  return out
}

/** Pull MeshHeadingList out of the same XML the paper backfill already parses. */
function meshFromArticle(ml) {
  const list = ml?.MeshHeadingList?.[0]?.MeshHeading || []
  const out = []
  for (const h of list) {
    const d = h.DescriptorName?.[0]
    if (!d) continue
    const name = typeof d === 'object' ? d._ || d['#text'] : String(d)
    if (!name) continue
    out.push({
      name: name.trim(),
      ui: d.$?.UI || null,                                  // MeSH descriptor id, e.g. D058604
      major: d.$?.MajorTopicYN === 'Y',                     // flagged as a major topic of the paper
      qualifiers: (h.QualifierName || []).map(q => (typeof q === 'object' ? q._ : String(q))).filter(Boolean),
    })
  }
  return out
}

async function efetchMesh(pmids) {
  const url = `${EUTILS}/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=xml${keyParam}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`efetch ${res.status}`)
  const parsed = await parseStringPromise(await res.text(), { explicitArray: true })
  const out = {}
  for (const article of parsed?.PubmedArticleSet?.PubmedArticle || []) {
    const ml = article.MedlineCitation?.[0]
    const pmid = String(ml?.PMID?.[0]?._ || ml?.PMID?.[0] || '')
    if (pmid) out[pmid] = meshFromArticle(ml)
  }
  return out
}

// ── Load the work queue ─────────────────────────────────────────────────────
/** Every paper with a PubMed id. `mesh` is only selected when the column exists. */
async function loadPapers(withMesh) {
  const cols = withMesh ? 'id,pubmed_id,mesh' : 'id,pubmed_id'
  const rows = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('papers').select(cols)
      .not('pubmed_id', 'is', null).order('id').range(f, f + 999)
    if (error) { console.error(error.message); break }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

// ── Tally mode: what to actually map ────────────────────────────────────────
// Reads the database when the column exists, otherwise the on-disk cache, so
// the frequency table can be built before the migration has been run.
if (TALLY) {
  // Prefer whichever source has more records — the cache is complete as soon as
  // the fetch finishes, while the database fills in gradually during --load.
  const cache = readCache()
  const inDb = await hasMeshColumn()
  const dbRows = inDb ? await loadPapers(true) : []
  const dbTagged = dbRows.filter(r => (r.mesh || []).length).length
  const cacheTagged = Object.values(cache).filter(m => m.length).length
  let rows
  if (cacheTagged > dbTagged) {
    rows = Object.entries(cache).map(([pmid, mesh]) => ({ pubmed_id: pmid, mesh }))
    console.log(`(reading the on-disk cache: ${cacheTagged.toLocaleString()} tagged vs ${dbTagged.toLocaleString()} in the database)`)
  } else {
    rows = dbRows
  }
  const withMesh = rows.filter(r => (r.mesh || []).length)
  const freq = {}, major = {}
  for (const r of rows) for (const m of r.mesh || []) {
    freq[m.name] = (freq[m.name] || 0) + 1
    if (m.major) major[m.name] = (major[m.name] || 0) + 1
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
  console.log(`papers with MeSH: ${withMesh.length}/${rows.length}`)
  console.log(`distinct headings: ${sorted.length}`)
  let cum = 0
  const totalAssignments = sorted.reduce((a, [, n]) => a + n, 0)
  const top = sorted.map(([name, n]) => {
    cum += n
    return { name, papers: n, major: major[name] || 0, cumShare: +(cum / totalAssignments).toFixed(4) }
  })
  writeFileSync(join(HERE, '../docs/mesh-frequency.json'), JSON.stringify(top, null, 2))
  console.log('\ntop 40 headings:')
  top.slice(0, 40).forEach(t => console.log(`  ${String(t.papers).padStart(6)}  ${t.name}`))
  const n250 = top.slice(0, 250).reduce((a, t) => a + t.papers, 0)
  console.log(`\ntop 250 headings cover ${(100 * n250 / totalAssignments).toFixed(1)}% of all heading assignments`)
  console.log('→ docs/mesh-frequency.json')
  process.exit(0)
}

// ── Dry run: prove parsing works before touching 83k rows ───────────────────
if (DRY) {
  const { data } = await sb.from('papers').select('pubmed_id,title').not('pubmed_id', 'is', null).limit(5)
  const ids = data.map(d => d.pubmed_id)
  console.log(`dry run on ${ids.length} papers…\n`)
  const mesh = await efetchMesh(ids)
  for (const d of data) {
    console.log(`• ${d.title.slice(0, 78)}`)
    const m = mesh[d.pubmed_id] || []
    console.log(`  ${m.length} headings: ${m.slice(0, 8).map(x => (x.major ? `*${x.name}` : x.name)).join(' · ') || '(none)'}\n`)
  }
  console.log('* = flagged by the indexer as a major topic of the paper')
  process.exit(0)
}

// ── Load mode: push the on-disk cache into the database ─────────────────────
if (LOAD) {
  if (!await hasMeshColumn()) {
    console.error('The `mesh` column does not exist. Run supabase/migrations/001-facets.sql first.')
    process.exit(1)
  }
  const cache = readCache()
  const papers = await loadPapers(true)
  const todo = papers.filter(p => !(p.mesh || []).length && (cache[p.pubmed_id] || []).length)
  console.log(`loading ${todo.length.toLocaleString()} cached MeSH records into the database…`)
  let ok = 0
  for (let i = 0; i < todo.length; i += 25) {
    await Promise.all(todo.slice(i, i + 25).map(async p => {
      const { error } = await sb.from('papers').update({ mesh: cache[p.pubmed_id] }).eq('id', p.id)
      if (!error) ok++
    }))
    process.stdout.write(`\r  ${ok.toLocaleString()}/${todo.length.toLocaleString()}`)
  }
  console.log(`\n✓ ${ok.toLocaleString()} papers now carry MeSH headings in the database`)
  process.exit(0)
}

// ── Fetch pass ──────────────────────────────────────────────────────────────
// Always writes to the on-disk cache. Also writes straight to the database when
// the column already exists, so a single run does everything post-migration.
const toDb = await hasMeshColumn()
const cached = readCache()
const papers = await loadPapers(toDb)
const todo = papers.filter(p => !cached[p.pubmed_id] && !(p.mesh || []).length)

console.log(`${papers.length.toLocaleString()} papers with a PubMed id`)
console.log(`${Object.keys(cached).length.toLocaleString()} already cached · ${todo.length.toLocaleString()} to fetch`)
console.log(`writing to: cache${toDb ? ' + database' : ' only (mesh column not created yet)'}`)
console.log(`rate: ${API_KEY ? 10 : 3} req/s (${API_KEY ? 'NCBI key found' : 'no NCBI_API_KEY — set one to go 3x faster'})\n`)
if (!todo.length) { console.log('nothing to do'); process.exit(0) }

let done = 0, got = 0, wrote = 0, failed = 0
const started = Date.now()
for (let i = 0; i < todo.length; i += BATCH) {
  const chunk = todo.slice(i, i + BATCH)
  let mesh = {}
  try { mesh = await efetchMesh(chunk.map(c => c.pubmed_id)) }
  catch { failed += chunk.length; await sleep(1500); continue }

  // Cache every paper we asked about, including those with no headings, so a
  // resumed run doesn't keep re-requesting them.
  const lines = chunk.map(c => JSON.stringify({ pmid: c.pubmed_id, mesh: mesh[c.pubmed_id] || [] }))
  appendFileSync(CACHE, lines.join('\n') + '\n')
  got += chunk.filter(c => (mesh[c.pubmed_id] || []).length).length

  if (toDb) {
    const writes = chunk.filter(c => (mesh[c.pubmed_id] || []).length)
    for (let j = 0; j < writes.length; j += 25) {
      await Promise.all(writes.slice(j, j + 25).map(async c => {
        const { error } = await sb.from('papers').update({ mesh: mesh[c.pubmed_id] }).eq('id', c.id)
        if (!error) wrote++
      }))
    }
  }

  done += chunk.length
  const rate = done / ((Date.now() - started) / 1000)
  const eta = Math.round((todo.length - done) / rate / 60)
  process.stdout.write(`\r  ${done.toLocaleString()}/${todo.length.toLocaleString()} · ${got.toLocaleString()} with headings · ${failed} failed · ~${eta}m left   `)
  await sleep(PACE)
}
console.log(`\n✓ fetched ${done.toLocaleString()} papers, ${got.toLocaleString()} carry MeSH headings`)
console.log(`  cache: mesh-cache.ndjson`)
if (toDb) console.log(`  database: ${wrote.toLocaleString()} rows updated`)
else console.log(`  run the migration, then: node --env-file=.env scripts/backfill-mesh.js --load`)
console.log(`\nNext: node --env-file=.env scripts/backfill-mesh.js --tally`)
