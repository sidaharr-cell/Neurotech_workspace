/**
 * purge-devices.js — Step 2 cleanup for the devices table.
 *
 *   1. Back up every row it is about to delete to a timestamped JSON file
 *      (recoverable — nothing is destroyed without a copy on disk first).
 *   2. Delete out-of-scope devices (in_scope = false — surgical instruments,
 *      gel, coils, etc., identified by FDA product code).
 *   3. De-duplicate the remainder, keeping the earliest row (lowest id) for
 *      each (name, product_code) and deleting the rest.
 *
 *   node --env-file=.env scripts/purge-devices.js --dry   # report only
 *   node --env-file=.env scripts/purge-devices.js         # back up + delete
 *
 * Re-runnable and safe to re-run: after a clean run there is nothing left to do.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const DRY = process.argv.includes('--dry')

// Keyset-paginate the whole table (OFFSET times out on large tables).
async function allDevices() {
  const rows = []
  let cur = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await sb.from('devices')
      .select('id,name,product_code,status,in_scope,facet_function').gt('id', cur).order('id').limit(1000)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...data)
    cur = data[data.length - 1].id
    if (data.length < 1000) break
  }
  return rows
}

const devices = await allDevices()
console.log(`devices: ${devices.length}`)

// 1 — out of scope
const outOfScope = devices.filter(d => d.in_scope === false)

// 2 — duplicates among the rows we are KEEPING (in-scope only). Keep the
// earliest id per (name, product_code); the rest are duplicates.
const keep = devices.filter(d => d.in_scope !== false)
const firstSeen = new Map()
const dupes = []
for (const d of keep) {
  const key = `${(d.name || '').toLowerCase().trim()}|${d.product_code || ''}`
  if (firstSeen.has(key)) dupes.push(d)
  else firstSeen.set(key, d.id)
}

const toDelete = [...outOfScope, ...dupes]
console.log(`  out of scope:        ${outOfScope.length}`)
console.log(`  in-scope duplicates: ${dupes.length}`)
console.log(`  total to delete:     ${toDelete.length}`)
console.log(`  will remain:         ${devices.length - toDelete.length}`)

if (!toDelete.length) { console.log('nothing to do'); process.exit(0) }

if (DRY) {
  console.log('\nsample out-of-scope:', outOfScope.slice(0, 5).map(d => d.name).join(' · '))
  console.log('sample duplicates:  ', dupes.slice(0, 5).map(d => d.name).join(' · '))
  console.log('\ndry run — nothing written or deleted')
  process.exit(0)
}

// Back up the FULL rows before deleting anything.
const ids = toDelete.map(d => d.id)
const backup = []
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('devices').select('*').in('id', ids.slice(i, i + 200))
  backup.push(...(data || []))
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const path = join(HERE, `../purged-devices-${stamp}.json`)
writeFileSync(path, JSON.stringify({ reason: 'Step 2 purge', when: stamp, outOfScope: outOfScope.length, dupes: dupes.length, rows: backup }, null, 2))
console.log(`\n✓ backed up ${backup.length} rows → ${path}`)

// Delete.
let deleted = 0
for (let i = 0; i < ids.length; i += 200) {
  const { error } = await sb.from('devices').delete().in('id', ids.slice(i, i + 200))
  if (error) { console.error('delete error:', error.message); break }
  deleted += Math.min(200, ids.length - i)
  process.stdout.write(`\r  deleted ${deleted}/${ids.length}`)
}
console.log(`\n✓ deleted ${deleted} rows (${outOfScope.length} out-of-scope + ${dupes.length} duplicates)`)
