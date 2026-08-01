/**
 * backfill-images.js — give every surfaced record a real picture.
 *
 *   node --env-file-if-exists=.env scripts/backfill-images.js               # DRY RUN
 *   node --env-file-if-exists=.env scripts/backfill-images.js --commit
 *   … --type=feed,trials,devices,orgs   default: all four
 *   … --limit=200                       rows per type
 *   … --force                           re-source rows that already have one
 *
 * Dry run by default, like every other backfill here, so a local run cannot
 * write to production by accident.
 *
 * The cascade, per record:
 *
 *   paper / preprint   its own figure, from bioRxiv/medRxiv or from Europe PMC
 *                      when the paper is open access. Then the class fallback.
 *   news               the photograph the outlet published (og:image), vision
 *                      checked so stock art and publisher logos are refused.
 *                      Then the class fallback.
 *   trial              the class fallback. Nothing photographs a trial.
 *   device             the class fallback, with openFDA's name for the product
 *                      code read first: a 510(k) row calls itself "Ceribell
 *                      Brain Monitor Headband" and only its product code says
 *                      "electroencephalograph".
 *   company            its own logo, from Wikidata or from its site.
 *
 * The class fallback is a licensed photograph of the TECHNOLOGY, drawn from
 * the reviewed pool in scripts/data/class-images.json and marked subject='class'
 * so the page can label it. It costs no API calls: the pool is resolved once by
 * scripts/build-class-images.js.
 *
 * Records whose class has no confirmable photograph keep their data figure.
 * That is a normal outcome, not a failure.
 */
import { createClient } from '@supabase/supabase-js'
import {
  resolvePaperImage, resolveOrgImage, ogImage, classifyImageUrl, measureImage, CARD_RES,
  classifyTechnology, productCodeText, loadClassImages, pickClassImage, saveProductCodes,
} from './lib/images.js'

const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const COMMIT = process.argv.includes('--commit')
const FORCE = process.argv.includes('--force')
const LIMIT = Number(arg('limit', 200))
const TYPES = new Set((arg('type', 'feed,trials,devices,orgs')).split(','))

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const pool = loadClassImages()
if (!Object.keys(pool).length) {
  console.error('scripts/data/class-images.json is empty. Run scripts/build-class-images.js --commit first.')
  process.exit(1)
}

const tally = { item: 0, class: 0, none: 0 }
const note = (label, img, why = '') => {
  if (img) tally[img.subject]++
  else tally.none++
  console.log(`  ${img ? (img.subject === 'item' ? '●' : '○') : '·'} ${label.slice(0, 52).padEnd(54)} ${img ? `${img.subject}/${img.source} ${img.w}x${img.h}` : why || 'no image'}`)
}

/** The class photograph for a record, or null. Costs nothing: the pool is
 *  already resolved and reviewed. The pick is seeded by the record id so a row
 *  keeps the same picture between runs. */
function classImageFor(entity, extra = '') {
  const cls = classifyTechnology(entity, extra)
  if (!cls) return { img: null, why: 'no technology named' }
  const img = pickClassImage(pool, cls.id, entity.id)
  return img
    ? { img: { ...img, classId: cls.id, subject: 'class' }, why: null }
    : { img: null, why: `${cls.id}: no confirmed photograph` }
}

/** metadata keys for a news_feed row. camelCase, beside the ones already there. */
const toMetadata = img => ({
  image: img.url,
  imageKind: img.kind,
  imageSubject: img.subject,
  imageCredit: img.credit || null,
  imageLicense: img.license || null,
  imageLicenseUrl: img.licenseUrl || null,
  imageSource: img.source,
  imageSourceUrl: img.sourceUrl || null,
  imageClassId: img.classId || null,
  imageW: img.w || null,
  imageH: img.h || null,
  imageCheckedAt: new Date().toISOString(),
})

/** columns for devices and organizations. */
const toColumns = img => ({
  image_url: img.url,
  image_kind: img.kind,
  image_subject: img.subject,
  image_credit: img.credit || null,
  image_license: img.license || null,
  image_license_url: img.licenseUrl || null,
  image_source: img.source,
  image_source_url: img.sourceUrl || null,
  image_w: img.w || null,
  image_h: img.h || null,
  image_checked_at: new Date().toISOString(),
})

/** An update that writes ONLY the image columns, per the write invariant in
 *  CLAUDE.md: organizations has more than one owner and nothing deletes a row
 *  to change it. */
async function write(table, id, patch) {
  if (!COMMIT) return true
  const { error } = await sb.from(table).update(patch).eq('id', id)
  if (error) {
    if (/column .* does not exist/i.test(error.message)) {
      console.error(`\n${table}: ${error.message}`)
      console.error('Apply supabase/migrations/016-entity-images.sql in the Supabase SQL editor first.')
      process.exit(1)
    }
    console.error(`  write failed for ${table} ${id}: ${error.message}`)
    return false
  }
  return true
}

// ── Feed: papers, preprints, news ───────────────────────────────────────────

async function doFeed() {
  const { data, error } = await sb.from('news_feed').select('id,title,url,source,entry_type,topics,metadata')
    .in('entry_type', ['paper', 'preprint', 'news']).limit(500)
  if (error) throw error
  const rows = data
    .sort((a, b) => (b.metadata?.rankScore ?? 0) - (a.metadata?.rankScore ?? 0))
    .filter(r => FORCE || !r.metadata?.image)
    .slice(0, LIMIT)
  console.log(`\nFeed: ${rows.length} rows without a picture (of ${data.length} fetched)`)

  for (const row of rows) {
    let img = null
    if (row.entry_type === 'news') {
      const url = await ogImage(row.url)
      if (url) {
        const dims = await measureImage(url)
        if (CARD_RES(dims) && (await classifyImageUrl(url)) === 'real') {
          img = {
            url, kind: 'photo', subject: 'item', credit: row.source || null, license: null,
            licenseUrl: null, source: 'og', sourceUrl: row.url, w: dims.width, h: dims.height,
          }
        }
      }
    } else {
      img = await resolvePaperImage(row)
    }
    let why = ''
    if (!img) ({ img, why } = classImageFor(row))
    note(row.title || row.id, img, why)
    if (img) await write('news_feed', row.id, { metadata: { ...(row.metadata || {}), ...toMetadata(img) } })
  }
}

// ── Trials ──────────────────────────────────────────────────────────────────

async function doTrials() {
  const { data, error } = await sb.from('news_feed')
    .select('id,title,summary,topics,metadata')
    .eq('entry_type', 'trial')
    .order('relevance_score', { ascending: false })
    .limit(LIMIT * 2)
  if (error) throw error
  const rows = data.filter(r => FORCE || !r.metadata?.image).slice(0, LIMIT)
  console.log(`\nTrials: ${rows.length} rows without a picture`)

  for (const row of rows) {
    const { img, why } = classImageFor(row)
    note(row.title || row.id, img, why)
    if (img) await write('news_feed', row.id, { metadata: { ...(row.metadata || {}), ...toMetadata(img) } })
  }
}

// ── Devices ─────────────────────────────────────────────────────────────────

async function doDevices() {
  const { data, error } = await sb.from('devices')
    .select('id,name,description,manufacturer,product_code,image_url')
    .order('year', { ascending: false, nullsFirst: false })
    .limit(LIMIT * 2)
  if (error) {
    if (/image_url/.test(error.message)) {
      console.error('\ndevices: image columns are missing. Apply supabase/migrations/016-entity-images.sql first.')
      return
    }
    throw error
  }
  const rows = data.filter(r => FORCE || !r.image_url).slice(0, LIMIT)
  console.log(`\nDevices: ${rows.length} rows without a picture`)

  for (const row of rows) {
    const { img, why } = classImageFor(row, await productCodeText(row.product_code))
    note(row.name || row.id, img, why)
    if (img) await write('devices', row.id, toColumns(img))
  }
  saveProductCodes()
}

// ── Companies ───────────────────────────────────────────────────────────────

async function doOrgs() {
  const { data, error } = await sb.from('organizations')
    .select('id,name,display_name,website,image_url')
    .eq('type', 'company')
    .not('inclusion_basis', 'is', null)
    .limit(LIMIT * 2)
  if (error) throw error
  const rows = data.filter(r => FORCE || !r.image_url).slice(0, LIMIT)
  console.log(`\nCompanies: ${rows.length} rows without a mark`)

  for (const row of rows) {
    const img = await resolveOrgImage(row)
    note(row.display_name || row.name, img, 'no logo found')
    if (img) await write('organizations', row.id, toColumns(img))
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(COMMIT ? 'Writing to Supabase.' : 'DRY RUN. Nothing is written. Add --commit to write.')
if (TYPES.has('feed')) await doFeed()
if (TYPES.has('trials')) await doTrials()
if (TYPES.has('devices')) await doDevices()
if (TYPES.has('orgs')) await doOrgs()

const total = tally.item + tally.class + tally.none
console.log(`\n● ${tally.item} pictures of the record itself`)
console.log(`○ ${tally.class} labelled class photographs`)
console.log(`· ${tally.none} kept their data figure`)
console.log(`  ${total ? Math.round(((tally.item + tally.class) / total) * 100) : 0}% of ${total} records have a picture`)
if (!COMMIT) console.log('\nDry run. Re-run with --commit to write.')
