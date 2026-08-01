/**
 * verify-images.js — the rot check.
 *
 *   node --env-file-if-exists=.env scripts/verify-images.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/verify-images.js --commit
 *   … --stale-days=30    only re-check images not checked in this long
 *   … --limit=300        images per type
 *
 * Images are hotlinked, not copied, so a publisher reorganising its CDN turns a
 * card into a broken box. This walks the stored URLs, and clears the image
 * block of anything that no longer answers with an image. A record with its
 * image cleared falls back to its data figure, which is the correct state: a
 * missing picture, not a broken one.
 *
 * Exits non-zero when more than a fifth of the checked images are gone, which
 * is the shape of a source that has moved wholesale rather than of ordinary
 * link rot.
 */
import { createClient } from '@supabase/supabase-js'
import { verifyImage } from './lib/images.js'

const arg = (n, d = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const COMMIT = process.argv.includes('--commit')
const LIMIT = Number(arg('limit', 300))
const STALE_DAYS = Number(arg('stale-days', 30))
const staleBefore = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const IMAGE_COLUMNS = [
  'image_url', 'image_kind', 'image_subject', 'image_credit', 'image_license',
  'image_license_url', 'image_source', 'image_source_url', 'image_w', 'image_h',
]
const CLEARED_COLUMNS = Object.fromEntries(IMAGE_COLUMNS.map(c => [c, null]))
const METADATA_KEYS = [
  'image', 'imageKind', 'imageSubject', 'imageCredit', 'imageLicense', 'imageLicenseUrl',
  'imageSource', 'imageSourceUrl', 'imageClassId', 'imageW', 'imageH',
]

let checked = 0, gone = 0

async function checkTable(table) {
  const { data, error } = await sb.from(table)
    .select('id,name,image_url,image_checked_at')
    .not('image_url', 'is', null)
    .or(`image_checked_at.is.null,image_checked_at.lt.${staleBefore}`)
    .limit(LIMIT)
  if (error) {
    if (/image_url/.test(error.message)) { console.log(`${table}: no image columns yet, skipping.`); return }
    throw error
  }
  console.log(`\n${table}: ${data.length} images due a check`)
  for (const row of data) {
    const res = await verifyImage(row.image_url)
    checked++
    if (res.ok) {
      if (COMMIT) await sb.from(table).update({ image_checked_at: new Date().toISOString() }).eq('id', row.id)
      continue
    }
    gone++
    console.log(`  gone (${res.status}) ${String(row.name || row.id).slice(0, 44)}`)
    if (COMMIT) await sb.from(table).update({ ...CLEARED_COLUMNS, image_checked_at: new Date().toISOString() }).eq('id', row.id)
  }
}

async function checkFeed() {
  const { data, error } = await sb.from('news_feed').select('id,title,metadata').limit(1000)
  if (error) throw error
  const rows = data.filter(r => r.metadata?.image
    && (!r.metadata.imageCheckedAt || r.metadata.imageCheckedAt < staleBefore)).slice(0, LIMIT)
  console.log(`\nnews_feed: ${rows.length} images due a check`)
  for (const row of rows) {
    const res = await verifyImage(row.metadata.image)
    checked++
    const metadata = { ...row.metadata, imageCheckedAt: new Date().toISOString() }
    if (!res.ok) {
      gone++
      console.log(`  gone (${res.status}) ${String(row.title || row.id).slice(0, 44)}`)
      for (const k of METADATA_KEYS) delete metadata[k]
    }
    if (COMMIT) await sb.from('news_feed').update({ metadata }).eq('id', row.id)
  }
}

console.log(COMMIT ? 'Writing to Supabase.' : 'DRY RUN. Nothing is written. Add --commit to write.')
await checkFeed()
await checkTable('devices')
await checkTable('organizations')

const pct = checked ? Math.round((gone / checked) * 100) : 0
console.log(`\n${checked} checked, ${gone} gone (${pct}%)`)
if (!COMMIT) console.log('Dry run. Re-run with --commit to clear the dead ones.')
if (checked >= 20 && pct > 20) {
  console.error(`\nMore than a fifth of the images are gone. That is a source moving wholesale, not link rot. Check the sources before the next run.`)
  process.exit(1)
}
