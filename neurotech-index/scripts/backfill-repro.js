/**
 * backfill-repro.js — detect code/data availability links in existing papers'
 * abstracts and store them (Phase 5). Requires migration 005.
 *   node --env-file=.env scripts/backfill-repro.js
 *
 * Keyset-paginates the primary key (fast, avoids the fat-table timeouts that bit
 * the provenance backfill) and writes ONLY papers where a link was found, in
 * small chunks with retry. Papers with no link are left as the default []. Safe
 * to re-run: a paper whose links are unchanged is written the same values.
 */
import { createClient } from '@supabase/supabase-js'
import { scanReproLinks } from '../src/lib/repro.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const READ_LIMIT = 1000
const WRITE_CHUNK = 50

async function upsertChunk(rows) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await sb.from('papers').upsert(rows, { onConflict: 'id' })
    if (!error) return true
    if (!/timeout/i.test(error.message) || attempt === 4) { console.warn('\n  upsert error:', error.message); return false }
    await sleep(500 * attempt)
  }
  return false
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).')
    process.exit(1)
  }
  let scanned = 0, withLinks = 0, wrote = 0, deferred = 0
  let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await sb.from('papers')
      .select('id,title,abstract').gt('id', last).order('id').limit(READ_LIMIT)
    if (error) { console.warn('\n  read error:', error.message); break }
    if (!data?.length) break
    last = data[data.length - 1].id
    scanned += data.length

    const rows = []
    for (const p of data) {
      const { code, data: dat } = scanReproLinks(`${p.title || ''} ${p.abstract || ''}`)
      if (code.length || dat.length) rows.push({ id: p.id, title: p.title, code_urls: code, data_urls: dat })
    }
    withLinks += rows.length
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK)
      if (await upsertChunk(chunk)) wrote += chunk.length
      else deferred += chunk.length
    }
    process.stdout.write(`\r  scanned ${scanned}, with links ${withLinks}, written ${wrote}${deferred ? `, deferred ${deferred}` : ''}`)
    if (data.length < READ_LIMIT) break
  }
  process.stdout.write('\n')
  if (deferred) console.warn(`  ${deferred} deferred by timeout; re-run to finish them.`)
  console.log(`Done. ${wrote} papers tagged with code/data links (of ${scanned} scanned).`)
}

main().catch(err => { console.error(err); process.exit(1) })
