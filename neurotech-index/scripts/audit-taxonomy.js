/**
 * audit-taxonomy.js — full-corpus audit of the Device Class classification.
 *
 * Scans every row of every content table and measures the two classifiers the
 * site actually runs:
 *   Path A (stored tags)  — what the section pages filter on server-side via
 *                           .contains(): papers.tags, devices.tags, patents.tags,
 *                           news_feed.topics, organizations.focus_areas.
 *   Path B (regex)        — what Feed / Search / Companies / directory rails
 *                           compute client-side via entityMatchesClass(), i.e.
 *                           substring match over JSON.stringify(entity).
 *
 * Reports coverage, per-class counts, multi-class overlap, A-vs-B divergence,
 * keyword-level fire counts with the words that triggered them, and a worklist
 * of unclassified rows.
 *
 *   node --env-file=.env scripts/audit-taxonomy.js
 *
 * Writes audit-taxonomy.json (full numbers) + audit-taxonomy.md (summary).
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'

const OUT = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const IDS = DEVICE_CLASSES.map(c => c.id)

// ── Path B: replicate entityMatchesClass exactly ────────────────────────────
const haystack = e => JSON.stringify(e || {}).toLowerCase()
const regexClasses = e => {
  const h = haystack(e)
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}

// Path B sees normalized objects on Search/Directory, raw rows on the Feed.
// Replicating the normalizers matters: they drop `fts`, ids and timestamps.
const NORMALIZE = {
  papers: p => ({ title: p.title, authors: p.authors || [], journal: p.journal, year: p.year, doi: p.doi, url: p.url, abstract: p.abstract, tags: p.tags || [], pubmedId: p.pubmed_id, arxivId: p.arxiv_id, source: p.source }),
  devices: d => ({ name: d.name, manufacturer: d.manufacturer, type: d.type, year: d.year, status: d.status, signalType: d.signal_type, channels: d.channels, description: d.description, modality: d.modality || [], tags: d.tags || [], url: d.url }),
  organizations: o => ({ name: o.name, type: o.type, location: o.location, founded: o.founded, description: o.description, focusAreas: o.focus_areas || [], website: o.website, founders: o.founders || [] }),
  researchers: r => ({ name: r.name, affiliation: r.affiliation, role: r.role, bio: r.bio, expertise: r.expertise || [], notableWork: r.notable_work || [] }),
}

// ── Sources: table, columns Path A/B see, and the stored-tag field ───────────
const SOURCES = [
  { key: 'papers',        table: 'papers',        tagField: 'tags',        page: 500,
    cols: 'title,authors,journal,year,doi,url,abstract,tags,pubmed_id,arxiv_id,source', label: t => t.title },
  { key: 'patents',       table: 'patents',       tagField: 'tags',        page: 1000,
    cols: 'patent_number,title,abstract,assignee,grant_date,cpc_codes,tags,url', label: t => t.title },
  { key: 'devices',       table: 'devices',       tagField: 'tags',        page: 1000,
    cols: 'name,manufacturer,type,year,status,signal_type,channels,description,modality,tags,url', label: t => t.name },
  { key: 'trials',        table: 'news_feed',     tagField: 'topics',      page: 1000, eq: ['entry_type', 'trial'],
    cols: 'title,summary,source,url,published_at,topics,relevance_score,entry_type,metadata', label: t => t.title },
  { key: 'news',          table: 'news_feed',     tagField: 'topics',      page: 1000, neq: ['entry_type', 'trial'],
    cols: 'title,summary,source,url,published_at,topics,relevance_score,entry_type,metadata', label: t => t.title },
  { key: 'organizations', table: 'organizations', tagField: 'focus_areas', page: 1000,
    cols: 'name,type,location,founded,description,focus_areas,website,founders', label: t => t.name },
  { key: 'researchers',   table: 'researchers',   tagField: 'expertise',   page: 1000,
    cols: 'name,affiliation,role,bio,expertise,notable_work', label: t => t.name },
]

const blank = () => ({ both: 0, storedOnly: 0, regexOnly: 0 })

async function auditSource(s) {
  const r = {
    key: s.key, table: s.table, tagField: s.tagField, n: 0,
    stored: { none: 0, dist: {}, per: {} }, regex: { none: 0, dist: {}, per: {} },
    agree: 0, per: {}, pairs: {}, keywords: {}, kwWords: {},
    unmatchedBoth: [], nonClassTagValues: {},
  }
  IDS.forEach(id => { r.stored.per[id] = 0; r.regex.per[id] = 0; r.per[id] = blank() })

  for (let from = 0; ; from += s.page) {
    let q = sb.from(s.table).select(s.cols).order('id').range(from, from + s.page - 1)
    if (s.eq) q = q.eq(...s.eq)
    if (s.neq) q = q.neq(...s.neq)
    const { data, error } = await q
    if (error) { console.error(`  ${s.key}: ${error.message}`); break }
    if (!data?.length) break

    for (const row of data) {
      r.n++
      // Path A — stored tags, exactly as .contains() would filter.
      const rawTags = row[s.tagField] || []
      const stored = rawTags.filter(t => IDS.includes(t))
      rawTags.filter(t => !IDS.includes(t)).forEach(t => { r.nonClassTagValues[t] = (r.nonClassTagValues[t] || 0) + 1 })
      // Path B — regex over the shape the client actually holds.
      const view = NORMALIZE[s.key] ? NORMALIZE[s.key](row) : row
      const rx = regexClasses(view)

      r.stored.dist[stored.length] = (r.stored.dist[stored.length] || 0) + 1
      r.regex.dist[rx.length] = (r.regex.dist[rx.length] || 0) + 1
      if (!stored.length) r.stored.none++
      if (!rx.length) r.regex.none++
      stored.forEach(id => r.stored.per[id]++)
      rx.forEach(id => r.regex.per[id]++)

      const S = new Set(stored), R = new Set(rx)
      if (S.size === R.size && [...S].every(x => R.has(x))) r.agree++
      for (const id of IDS) {
        const a = S.has(id), b = R.has(id)
        if (a && b) r.per[id].both++
        else if (a) r.per[id].storedOnly++
        else if (b) r.per[id].regexOnly++
      }

      // Overlap (non-MECE evidence) measured on the stored tags — the
      // classification of record for the section pages.
      for (let i = 0; i < stored.length; i++)
        for (let j = i + 1; j < stored.length; j++)
          { const k = [stored[i], stored[j]].sort().join(' + '); r.pairs[k] = (r.pairs[k] || 0) + 1 }

      // Keyword diagnostics: which keyword fired, and the whole word it sat in.
      const h = haystack(view)
      for (const c of DEVICE_CLASSES) for (const m of c.match) {
        const i = h.indexOf(m)
        if (i < 0) continue
        const k = `${c.id}:${m}`
        r.keywords[k] = (r.keywords[k] || 0) + 1
        let a = i, b = i + m.length
        while (a > 0 && /[a-z-]/.test(h[a - 1])) a--
        while (b < h.length && /[a-z-]/.test(h[b])) b++
        const w = h.slice(a, b)
        ;(r.kwWords[k] ||= {})[w] = (r.kwWords[k][w] || 0) + 1
      }

      if (!stored.length && !rx.length && r.unmatchedBoth.length < 300)
        r.unmatchedBoth.push(String(s.label(row) || '').slice(0, 120))
    }
    process.stdout.write(`\r  ${s.key}: ${r.n}`)
    if (data.length < s.page) break
  }
  console.log(`\r  ${s.key}: ${r.n} rows`)
  return r
}

// ── Run ─────────────────────────────────────────────────────────────────────
const results = {}
console.log('Auditing full corpus...')
for (const s of SOURCES) results[s.key] = await auditSource(s)

writeFileSync(join(OUT, '../audit-taxonomy.json'), JSON.stringify(results, null, 2))

// ── Readable summary ────────────────────────────────────────────────────────
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '—'
const L = []
L.push('# Device Class audit — full corpus\n')
L.push(`Generated ${new Date().toISOString().slice(0, 10)}. Path A = stored tags (section pages, server-side \`.contains\`). Path B = regex over \`JSON.stringify(entity)\` (Feed, Search, Companies, directory rails).\n`)

L.push('## Coverage — rows reachable by any class pill\n')
L.push('| Content | Rows | Path A tagged | Path B matched | A∩B identical |')
L.push('|---|---:|---:|---:|---:|')
for (const k of Object.keys(results)) {
  const r = results[k]
  if (!r.n) continue
  L.push(`| ${k} | ${r.n.toLocaleString()} | ${(r.n - r.stored.none).toLocaleString()} (${pct(r.n - r.stored.none, r.n)}) | ${(r.n - r.regex.none).toLocaleString()} (${pct(r.n - r.regex.none, r.n)}) | ${pct(r.agree, r.n)} |`)
}

L.push('\n## Overlap — how non-exclusive the scheme is (Path A)\n')
L.push('| Content | 0 classes | 1 | 2 | 3+ | top co-occurring pair |')
L.push('|---|---:|---:|---:|---:|---|')
for (const k of Object.keys(results)) {
  const r = results[k]; if (!r.n) continue
  const d = r.stored.dist
  const three = Object.entries(d).filter(([n]) => +n >= 3).reduce((a, [, v]) => a + v, 0)
  const top = Object.entries(r.pairs).sort((a, b) => b[1] - a[1])[0]
  L.push(`| ${k} | ${pct(d[0] || 0, r.n)} | ${pct(d[1] || 0, r.n)} | ${pct(d[2] || 0, r.n)} | ${pct(three, r.n)} | ${top ? `${top[0]} (${top[1].toLocaleString()})` : '—'} |`)
}

L.push('\n## Divergence — same pill, different page\n')
for (const k of Object.keys(results)) {
  const r = results[k]; if (!r.n) continue
  const rows = IDS.map(id => [id, r.per[id]]).filter(([, p]) => p.both || p.storedOnly || p.regexOnly)
  if (!rows.length) continue
  L.push(`\n**${k}** — identical on ${pct(r.agree, r.n)} of rows\n`)
  L.push('| class | both agree | section page only | feed/search only |')
  L.push('|---|---:|---:|---:|')
  rows.forEach(([id, p]) => L.push(`| ${id} | ${p.both.toLocaleString()} | ${p.storedOnly.toLocaleString()} | ${p.regexOnly.toLocaleString()} |`))
}

L.push('\n## Keyword false-positive leads\n')
L.push('Keywords whose matches are mostly *other words*. `share` = fraction of first-matches that were not the keyword standing alone.\n')
L.push('| content | keyword | fires | top containing words | suspect share |')
L.push('|---|---|---:|---|---:|')
for (const k of Object.keys(results)) {
  const r = results[k]; if (!r.n) continue
  const leads = []
  for (const [kw, words] of Object.entries(r.kwWords)) {
    const total = Object.values(words).reduce((a, b) => a + b, 0)
    const bare = kw.split(':').slice(1).join(':')
    const clean = words[bare] || 0
    const suspect = total - clean
    if (total >= 20 && suspect / total > 0.25) leads.push({ kw, total, suspect, words })
  }
  leads.sort((a, b) => b.suspect - a.suspect).slice(0, 6).forEach(l => {
    const top = Object.entries(l.words).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, c]) => `${w} (${c})`).join(', ')
    L.push(`| ${k} | \`${l.kw}\` | ${l.total.toLocaleString()} | ${top} | ${pct(l.suspect, l.total)} |`)
  })
}

L.push('\n## Unclassified by both paths — worklist samples\n')
for (const k of Object.keys(results)) {
  const r = results[k]; if (!r.unmatchedBoth.length) continue
  const total = Object.entries(r.stored.dist)
  L.push(`\n**${k}** — first ${Math.min(10, r.unmatchedBoth.length)} of ${r.stored.none.toLocaleString()} untagged:\n`)
  r.unmatchedBoth.slice(0, 10).forEach(t => L.push(`- ${t}`))
}

L.push('\n## Non-class values found in the tag fields\n')
for (const k of Object.keys(results)) {
  const r = results[k]
  const e = Object.entries(r.nonClassTagValues).sort((a, b) => b[1] - a[1])
  if (!e.length) continue
  L.push(`- **${k}.${r.tagField}** — ${e.length} distinct non-class values, e.g. ${e.slice(0, 8).map(([v, c]) => `${v} (${c})`).join(', ')}`)
}

writeFileSync(join(OUT, '../audit-taxonomy.md'), L.join('\n') + '\n')
console.log('\n✓ wrote audit-taxonomy.json and audit-taxonomy.md')
