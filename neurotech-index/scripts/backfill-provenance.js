/**
 * backfill-provenance.js — fill the provenance block on rows that predate
 * migration 003, from the columns that already hold that information.
 *   node --env-file=.env scripts/backfill-provenance.js
 *
 * Why this is a script and not part of the migration: a single full-table UPDATE
 * on the fat papers (~84k) and patents (~47k) tables rewrites every row and
 * exceeds the Supabase SQL editor's upstream timeout. This runs from the
 * terminal with the service key, batched, so there is no gateway limit.
 *
 * Idempotent by construction: it only touches rows where pipeline_version IS
 * NULL (i.e. never stamped). Each batch sets pipeline_version, so those rows
 * drop out of the next fetch. Rows already stamped by refresh.js/trials.js or by
 * a previous run are skipped. Re-running when everything is stamped is a no-op.
 *
 * first_seen / last_updated are set to created_at (the true first-seen), which
 * corrects the migration-time default the DDL left on legacy rows. source_id /
 * source_url / source are filled only where null. NOT NULL columns are echoed
 * back unchanged so the upsert's insert tuple satisfies its constraints.
 */
import { createClient } from '@supabase/supabase-js'

const STAMP = 'phase1-backfill'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const orNull = v => (v == null || v === '' ? null : v)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// The papers/patents tables are fat (a generated fts tsvector recomputes on
// every update) and have a short statement_timeout, so writes go in small
// chunks. A chunk that times out is retried a few times before giving up.
const WRITE_CHUNK = 50
const READ_LIMIT = 1000

async function upsertChunk(table, chunk) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await sb.from(table).upsert(chunk, { onConflict: 'id' })
    if (!error) return true
    if (!/timeout/i.test(error.message) || attempt === 4) {
      console.warn(`\n  ${table} upsert error:`, error.message)
      return false
    }
    await sleep(500 * attempt)
  }
  return false
}

// One config per table. `required` lists NOT NULL columns to echo. `derive`
// returns the provenance fields to fill (coalesced against existing values).
const TABLES = [
  {
    name: 'papers',
    required: ['title'],
    read: 'id,title,pubmed_id,arxiv_id,doi,url,created_at,source,source_id,source_url',
    derive: r => ({
      source_id: orNull(r.source_id) ?? orNull(r.pubmed_id) ?? orNull(r.arxiv_id) ?? orNull(r.doi),
      source_url: orNull(r.source_url) ?? orNull(r.url),
    }),
  },
  {
    name: 'devices',
    required: ['name'],
    read: 'id,name,product_code,url,created_at,source,source_id,source_url',
    derive: r => ({
      source: orNull(r.source) ?? 'openfda',
      source_id: orNull(r.source_id) ?? orNull(r.product_code),
      source_url: orNull(r.source_url) ?? orNull(r.url),
    }),
  },
  {
    name: 'patents',
    required: ['patent_number', 'title'],
    read: 'id,patent_number,title,url,created_at,source,source_id,source_url',
    derive: r => ({
      source_id: orNull(r.source_id) ?? orNull(r.patent_number),
      source_url: orNull(r.source_url) ?? orNull(r.url),
    }),
  },
  {
    name: 'news_feed',
    required: ['title', 'url'],
    read: 'id,title,url,metadata,created_at,source,source_id,source_url',
    derive: r => ({
      source_id: orNull(r.source_id) ?? orNull(r.metadata?.nctId) ?? orNull(r.url),
      source_url: orNull(r.source_url) ?? orNull(r.url),
    }),
  },
  {
    name: 'organizations',
    required: ['name'],
    read: 'id,name,website,created_at,source_url',
    derive: r => ({
      source_url: orNull(r.source_url) ?? orNull(r.website),
    }),
  },
  {
    name: 'researchers',
    required: ['name'],
    read: 'id,name,created_at',
    derive: () => ({}),
  },
]

async function backfillTable(cfg) {
  // Keyset-paginate over the primary key (always a fast index scan) and filter
  // in JS to rows still needing a stamp. This avoids scanning the fat table for
  // `pipeline_version IS NULL`, which times out once the null rows go sparse and
  // there is no index on that column. Every row is read once (light columns);
  // only unstamped rows are written, so re-runs read fast and write nothing.
  // id is a uuid; seed the keyset cursor below the minimum possible value.
  let total = 0, seen = 0, failed = 0, last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await sb
      .from(cfg.name)
      .select(`${cfg.read},pipeline_version`)
      .gt('id', last)
      .order('id')
      .limit(READ_LIMIT)
    if (error) { console.warn(`\n  ${cfg.name} read error:`, error.message); break }
    if (!data?.length) break
    last = data[data.length - 1].id
    seen += data.length

    const rows = data.filter(r => r.pipeline_version == null).map(r => {
      const echo = {}
      for (const col of cfg.required) echo[col] = r[col]
      return {
        id: r.id,
        ...echo,
        ...cfg.derive(r),
        first_seen: r.created_at,
        last_updated: r.created_at,
        pipeline_version: STAMP,
      }
    })

    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK)
      // Keyset cursor advances by id regardless of write success, so a chunk
      // that times out even after retries is skipped, not fatal: those rows stay
      // null and a re-run (which rescans by id and writes remaining nulls) mops
      // them up. This lets one pass get through the whole table under DB load.
      if (await upsertChunk(cfg.name, chunk)) total += chunk.length
      else failed += chunk.length
    }
    process.stdout.write(`\r  ${cfg.name}: ${total} stamped (${seen} scanned${failed ? `, ${failed} deferred` : ''})`)
    if (data.length < READ_LIMIT) break // reached the end of the table
  }
  if (total || failed) process.stdout.write('\n')
  if (failed) console.warn(`  ${cfg.name}: ${failed} rows deferred by timeout; re-run to finish them.`)
  if (!total && !failed) console.log(`  ${cfg.name}: nothing to do (already stamped)`)
  return total
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (run with --env-file=.env).')
    process.exit(1)
  }
  let grand = 0
  for (const cfg of TABLES) {
    console.log(`Backfilling ${cfg.name}...`)
    grand += await backfillTable(cfg)
  }
  console.log(`Done. ${grand} rows stamped with provenance.`)
}

main().catch(err => { console.error(err); process.exit(1) })
