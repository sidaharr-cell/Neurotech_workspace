/**
 * run-migration.js — apply a numbered migration without the SQL editor.
 *
 *   node --env-file=.env scripts/run-migration.js supabase/migrations/011-frontier-records.sql
 *   node --env-file=.env scripts/run-migration.js supabase/migrations/011-frontier-records.sql --commit
 *
 * Dry-run by default, like every other write script here.
 *
 * WHY. CLAUDE.md says migrations are run by hand in the Supabase SQL editor.
 * That is fine until one fails: the editor wraps a script in a single
 * transaction, so a fault anywhere discards everything, and the only signal
 * downstream is PostgREST reporting a missing table. This runs the same SQL and
 * reports the server's actual error with its line and position.
 *
 * NEITHER CREDENTIAL IS THE ANON OR SERVICE KEY. Those reach PostgREST, which
 * speaks tables and rows and cannot execute DDL at all. Schema changes need one
 * of these, in order of preference:
 *
 *   DATABASE_URL           Postgres connection string. Dashboard → Project
 *                          Settings → Database → Connection string → Session
 *                          pooler. Scoped to this one database, which is the
 *                          narrower blast radius and so the better choice.
 *                          Needs the `pg` package: npm i -D pg
 *
 *   SUPABASE_ACCESS_TOKEN  Personal access token (sbp_...) from
 *                          supabase.com/dashboard/account/tokens, used against
 *                          the Management API. No extra dependency, but it is
 *                          ACCOUNT-WIDE: it can reach every project you own,
 *                          including creating and deleting them. Prefer
 *                          DATABASE_URL, and revoke this when finished.
 *
 * Put the value in .env yourself. It is git-ignored and untracked; this script
 * reads it from the environment and never prints it.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const file = args.find(a => !a.startsWith('--'))

const RELOAD = "notify pgrst, 'reload schema';"

/** Run SQL over a direct Postgres connection. Preferred: scoped to one database. */
async function viaPostgres(sql) {
  let pg
  try { pg = (await import('pg')).default } catch {
    console.error('DATABASE_URL is set but the `pg` package is not installed.')
    console.error('  npm i -D pg')
    process.exit(1)
  }
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    // Supabase poolers present a certificate chain node does not ship a root
    // for. The connection is still TLS-encrypted.
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(sql)
    // PostgREST caches the schema; without this the new tables 404 until it
    // notices on its own.
    await client.query(RELOAD)
  } finally {
    await client.end()
  }
}

/** Run SQL through the Management API. No dependency, but account-wide auth. */
async function viaManagementApi(sql) {
  const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1]
  if (!ref) { console.error('Cannot derive the project ref from SUPABASE_URL.'); process.exit(1) }
  const post = async query => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 800)}`)
    return text
  }
  await post(sql)
  await post(RELOAD)
}

async function run() {
  if (!file) {
    console.error('Usage: node --env-file=.env scripts/run-migration.js <path-to.sql> [--commit]')
    process.exit(1)
  }
  const path = resolve(file)
  const sql = readFileSync(path, 'utf8')

  // Statement count is approximate: it ignores semicolons inside dollar-quoted
  // bodies. It is a sanity signal for the operator, not a parser.
  const approxStatements = sql.replace(/\$\$[\s\S]*?\$\$/g, '').split(';').filter(s => s.trim()).length
  const hasDollarBlocks = /\$\$/.test(sql)

  const mode = process.env.DATABASE_URL ? 'postgres'
    : process.env.SUPABASE_ACCESS_TOKEN ? 'management-api'
    : null

  console.log(`migration : ${file}`)
  console.log(`size      : ${sql.length} bytes, ~${approxStatements} statement(s)` +
    `${hasDollarBlocks ? ' plus dollar-quoted block(s)' : ''}`)
  console.log(`transport : ${mode || 'NONE AVAILABLE'}`)

  if (!mode) {
    console.error('\nNo credential that can execute DDL is configured.')
    console.error('SUPABASE_SERVICE_KEY reaches PostgREST only, which cannot run DDL.')
    console.error('\nAdd ONE of these to .env:')
    console.error('  DATABASE_URL=<Session pooler connection string>   (preferred, scoped to this database)')
    console.error('  SUPABASE_ACCESS_TOKEN=<sbp_... personal access token>   (account-wide; revoke after)')
    process.exit(1)
  }

  if (!COMMIT) {
    console.log('\nDry run. Nothing executed. Re-run with --commit to apply.')
    return
  }

  console.log('\napplying...')
  try {
    if (mode === 'postgres') await viaPostgres(sql)
    else await viaManagementApi(sql)
  } catch (err) {
    console.error('\nMIGRATION FAILED. Nothing was applied; the server ran it as one transaction.')
    console.error(err.message)
    // Postgres reports a character offset; turn it into a line the reader can find.
    const pos = /position[":\s]+(\d+)/i.exec(err.message)?.[1]
    if (pos) {
      const line = sql.slice(0, Number(pos)).split('\n').length
      console.error(`\n→ ${file}:${line}`)
      console.error(`   ${sql.split('\n')[line - 1]?.trim()}`)
    }
    process.exit(1)
  }
  console.log('✓ applied, and PostgREST asked to reload its schema cache.')
}

run().catch(e => { console.error(e); process.exit(1) })
