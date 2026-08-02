/**
 * apply-card-images.js — place the pictures a person chose by hand.
 *
 *   node --env-file-if-exists=.env scripts/apply-card-images.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/apply-card-images.js --commit
 *
 * Some records the general sources simply cannot reach: a story about
 * Neuralink's first patient, a paper about morphogen gradients in the fly
 * embryo. Commons holds exactly the right photograph for each, and no query
 * built from the record's own words finds it. So they are chosen by hand in
 * src/data/card-images.json, and this places them.
 *
 * The file names a Commons file and a reason, nothing more. The licence, the
 * author and the dimensions are read from Commons here, so the committed file
 * asserts no fact of its own and a wrong entry fails loudly rather than
 * publishing an unattributed picture.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { commonsFile } from './lib/images.js'

const COMMIT = process.argv.includes('--commit')
const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const picks = Object.entries(JSON.parse(readFileSync(join(HERE, '../src/data/card-images.json'), 'utf8')))
  .filter(([k]) => !k.startsWith('_'))
const NOTABLE_PATH = join(HERE, '../src/data/notable.json')
const notable = JSON.parse(readFileSync(NOTABLE_PATH, 'utf8'))

const metaKeys = img => ({
  image: img.url, imageKind: 'photo', imageSubject: 'class', imageCredit: img.credit,
  imageLicense: img.license, imageLicenseUrl: img.licenseUrl, imageSource: 'commons',
  imageSourceUrl: img.sourceUrl, imageW: img.w, imageH: img.h, imageCheckedAt: new Date().toISOString(),
})
const cols = img => ({
  image_url: img.url, image_kind: 'photo', image_subject: 'class', image_credit: img.credit,
  image_license: img.license, image_license_url: img.licenseUrl, image_source: 'commons',
  image_source_url: img.sourceUrl, image_w: img.w, image_h: img.h, image_checked_at: new Date().toISOString(),
})

// Looked up one at a time rather than scanned: PostgREST caps a select at a
// thousand rows however large the limit says, and a record past the cap looks
// exactly like a record that does not exist.
const findRow = async fragment => {
  const { data } = await sb.from('news_feed').select('id,title,metadata')
    .ilike('title', `%${fragment.replace(/[%_]/g, ' ')}%`).limit(1)
  return data?.[0] || null
}

let placed = 0, failed = 0
let notableChanged = false

for (const [fragment, pick] of picks) {
  const img = await commonsFile(pick.file, { subject: 'class', minWidth: 400 })
  if (!img) { console.error(`  ✗ ${pick.file} — not on Commons, or carries no licence and author`); failed++; continue }

  const row = await findRow(fragment)
  const note = notable.find(n => String(n.title || '').includes(fragment))
  if (!row && !note) { console.error(`  ✗ no record matches "${fragment}"`); failed++; continue }

  console.log(`  ● ${fragment.slice(0, 44).padEnd(46)} ${pick.file.slice(0, 40)}  (${img.w}x${img.h}, ${img.license})`)
  console.log(`      ${pick.why}`)
  placed++
  if (!COMMIT) continue
  if (row) await sb.from('news_feed').update({ metadata: { ...(row.metadata || {}), ...metaKeys(img) } }).eq('id', row.id)
  if (note) { Object.assign(note, cols(img)); notableChanged = true }
}

if (COMMIT && notableChanged) writeFileSync(NOTABLE_PATH, JSON.stringify(notable, null, 2) + '\n')
console.log(`\n${placed} placed, ${failed} could not be`)
if (!COMMIT) console.log('Dry run. Re-run with --commit to write.')
process.exit(failed ? 1 : 0)
