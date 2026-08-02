/**
 * verify-image-fit.js — does every class photograph still match its record?
 *
 *   node --env-file-if-exists=.env scripts/verify-image-fit.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/verify-image-fit.js --commit
 *
 * A class photograph is assigned from how a record read at the time. The
 * reading changes: a regex is corrected, a class is retired, a field stops
 * being searched. The picture does not change with it, and the mismatch is
 * silent — a paper about restoring hand movement in tetraplegia sat under a
 * chest radiograph of a vagus nerve stimulator for a day, because it had once
 * been read as a vagus record and nothing re-read it.
 *
 * So this re-reads every record that carries a class photograph and clears the
 * ones the current reading no longer supports. Cleared records fall back to
 * their data figure until the next fill offers them something better, which is
 * the right resting state: no picture beats the wrong picture.
 *
 * Hand-placed pictures (src/data/card-images.json) are left alone. A person
 * chose those against the headline itself, which is a stronger warrant than
 * any regex.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { classifyTechnology, productCodeText, loadClassImages } from './lib/images.js'

const COMMIT = process.argv.includes('--commit')
const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const pool = loadClassImages()
const classOfUrl = new Map(
  Object.entries(pool).flatMap(([id, c]) => c.images.map(i => [i.url, id])),
)
const handPlaced = new Set(
  Object.entries(JSON.parse(readFileSync(join(HERE, '../src/data/card-images.json'), 'utf8')))
    .filter(([k]) => !k.startsWith('_'))
    .map(([k]) => k.toLowerCase()),
)
const isHandPlaced = title => {
  const t = String(title || '').toLowerCase()
  return [...handPlaced].some(fragment => t.includes(fragment))
}

const METADATA_KEYS = ['image', 'imageKind', 'imageSubject', 'imageCredit', 'imageLicense',
  'imageLicenseUrl', 'imageSource', 'imageSourceUrl', 'imageClassId', 'imageW', 'imageH', 'imageCheckedAt']
const NULL_COLUMNS = Object.fromEntries(['image_url', 'image_kind', 'image_subject', 'image_credit',
  'image_license', 'image_license_url', 'image_source', 'image_source_url', 'image_w', 'image_h'].map(c => [c, null]))

let checked = 0
const wrong = []

// news_feed, in pages: PostgREST caps a select at a thousand rows however
// large the limit says, so a single query would quietly miss the tail.
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('news_feed')
    .select('id,title,topics,metadata').range(from, from + 999)
  if (error) throw error
  if (!data.length) break
  for (const row of data) {
    const img = row.metadata?.image
    if (!img || row.metadata?.imageSubject !== 'class') continue
    if (isHandPlaced(row.title)) continue
    checked++
    const want = classifyTechnology(row)?.id || null
    const have = classOfUrl.get(img) || row.metadata?.imageClassId || null
    if (want && have === want) continue
    wrong.push({ table: 'news_feed', id: row.id, title: row.title, have, want })
    if (COMMIT) {
      const metadata = { ...row.metadata }
      for (const k of METADATA_KEYS) delete metadata[k]
      await sb.from('news_feed').update({ metadata }).eq('id', row.id)
    }
  }
  if (data.length < 1000) break
}

const { data: devices } = await sb.from('devices')
  .select('id,name,description,manufacturer,product_code,image_url,image_subject')
  .eq('image_subject', 'class').limit(1000)
for (const d of devices || []) {
  checked++
  const want = classifyTechnology(d, await productCodeText(d.product_code))?.id || null
  const have = classOfUrl.get(d.image_url) || null
  if (want && have === want) continue
  wrong.push({ table: 'devices', id: d.id, title: d.name, have, want })
  if (COMMIT) await sb.from('devices').update(NULL_COLUMNS).eq('id', d.id)
}

for (const w of wrong.slice(0, 25)) {
  console.log(`  ${String(w.have || 'unknown').padEnd(16)} -> ${String(w.want || 'nothing').padEnd(16)} ${String(w.title).slice(0, 52)}`)
}
console.log(`\n${checked} class photographs checked, ${wrong.length} no longer match their record`)
if (!COMMIT && wrong.length) console.log('Dry run. Re-run with --commit to clear them.')
process.exit(!COMMIT && wrong.length ? 1 : 0)
