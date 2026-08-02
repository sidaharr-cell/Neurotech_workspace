/**
 * backfill-images.js — give every surfaced record a real picture.
 *
 *   node --env-file-if-exists=.env scripts/backfill-images.js               # DRY RUN
 *   node --env-file-if-exists=.env scripts/backfill-images.js --commit
 *   … --type=feed,trials,devices,orgs,notable   default: all five
 *   … --limit=200                       rows per type
 *   … --force                           re-source rows that already have one
 *   … --upgrade                         re-source rows holding a CLASS photograph,
 *                                       keeping it unless something of the record's
 *                                       own turns up
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
 * the reviewed pool in src/data/class-images.json and marked subject='class'
 * so the page can label it. It costs no API calls: the pool is resolved once by
 * scripts/build-class-images.js.
 *
 * Records whose class has no confirmable photograph keep their data figure.
 * That is a normal outcome, not a failure.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  resolvePaperImage, resolveOrgImage, resolveTrialImage, ogImage, classifyImageUrl, measureImage, CARD_RES,
  classifyTechnology, productCodeText, loadClassImages, pickClassImage, saveProductCodes,
  productName, wikipediaImage, siteProductImage, guessMakerSite, FALLBACK_CLASS,
} from './lib/images.js'

const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const COMMIT = process.argv.includes('--commit')
const FORCE = process.argv.includes('--force')
// A class photograph is the fallback, not the answer. --upgrade goes back over
// the records that settled for one and asks the item-specific sources again:
// a preprint that has since appeared on arXiv, a device whose maker's site has
// come up, a trial whose product now has a photograph.
const UPGRADE = process.argv.includes('--upgrade')
const LIMIT = Number(arg('limit', 200))
const TYPES = new Set((arg('type', 'feed,trials,devices,orgs,notable')).split(','))

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const pool = loadClassImages()
if (!Object.keys(pool).length) {
  console.error('src/data/class-images.json is empty. Run scripts/build-class-images.js --commit first.')
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
  // The class it matched, then the fallback. A record about microelectrode
  // arrays, a class Commons has no photograph of, is still a record about the
  // nervous system.
  for (const id of [cls.id, FALLBACK_CLASS].filter(Boolean)) {
    const img = pickClassImage(pool, id, entity.id)
    if (img) return { img: { ...img, classId: id, subject: 'class' }, why: null }
  }
  return { img: null, why: `${cls.id}: no confirmed photograph` }
}

/**
 * Maker name to website. openFDA gives a device a manufacturer's NAME and no
 * URL; the organizations table is where the URLs are. Matching is on the
 * normalized name, so "Cala Health, Inc." finds "Cala Health".
 */
const normName = s => String(s || '').toLowerCase()
  .replace(/\b(inc|llc|ltd|plc|corp|corporation|co|gmbh|srl|sa|nv|bv|ag|as|oy|ab|limited|company)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()

async function makerSites() {
  const { data } = await sb.from('organizations').select('name,display_name,website')
    .eq('type', 'company').not('website', 'is', null).limit(2000)
  const byName = new Map()
  for (const o of data || []) {
    for (const n of [o.display_name, o.name]) if (n) byName.set(normName(n), o.website)
  }
  return byName
}

/**
 * Products we already hold a picture of, by name.
 *
 * A trial of the Nerivio device is best represented by a photograph of
 * Nerivio, which the device row already has. The trial's own interventions
 * name the product, so the two can be joined on the name and the picture
 * reused rather than falling back to a photograph of the technology.
 */
async function productImages() {
  const { data, error } = await sb.from('devices')
    .select('name,image_url,image_kind,image_subject,image_credit,image_license,image_license_url,image_source,image_source_url,image_w,image_h')
    .not('image_url', 'is', null).eq('image_subject', 'item').limit(2000)
  if (error) return []
  return (data || []).map(d => ({
    name: productName(d),
    img: {
      url: d.image_url, kind: d.image_kind, subject: 'item', credit: d.image_credit,
      license: d.image_license, licenseUrl: d.image_license_url, source: d.image_source,
      sourceUrl: d.image_source_url, w: d.image_w, h: d.image_h,
    },
  })).filter(p => p.name.length > 3)
}

/**
 * The product or company a record names, if we hold a picture of it.
 *
 * Matching has to be strict, because the register is full of companies called
 * Restore, Stimulus, Cerebral and Mentia. A substring match would put the
 * Restore logo on any headline containing the word "restore". So: whole words
 * only, at least six characters, and never a name that is an ordinary English
 * word on its own.
 */
const GENERIC_NAMES = new Set([
  'restore', 'stimulus', 'cerebral', 'mentia', 'neuromod', 'stroke rehab', 'neurotechnology',
  'medical', 'neuroscience', 'research', 'clinical', 'therapy', 'health', 'brain', 'neuro',
  'science', 'digital', 'sensor', 'vision', 'motion', 'signal', 'element', 'freedom',
])

export function matchNamed(text, entries) {
  const haystack = String(text || '')
  for (const e of entries) {
    const name = String(e.name || '').trim()
    if (name.length < 6) continue
    if (GENERIC_NAMES.has(name.toLowerCase())) continue
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu')
    if (pattern.test(haystack)) return e.img
  }
  return null
}

/**
 * Companies we hold a picture of, by name.
 *
 * A story headlined "How Neuralink brain chip transformed life of ALS
 * sufferer" is about a company we already hold a mark for. The mark is a
 * poorer picture than a photograph of the work, but it is about this story,
 * which a photograph of somebody else's laboratory would not be.
 */
async function companyImages() {
  const { data, error } = await sb.from('organizations')
    .select('name,display_name,image_url,image_kind,image_subject,image_credit,image_license,image_license_url,image_source,image_source_url,image_w,image_h')
    .eq('type', 'company').not('image_url', 'is', null).limit(2000)
  if (error) return []
  return (data || []).map(o => ({
    name: (o.display_name || o.name || '').trim(),
    img: {
      url: o.image_url, kind: o.image_kind, subject: 'item', credit: o.image_credit,
      license: o.image_license, licenseUrl: o.image_license_url, source: o.image_source,
      sourceUrl: o.image_source_url, w: o.image_w, h: o.image_h,
    },
  })).filter(c => c.name.length > 3)
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
    .filter(r => FORCE || !r.metadata?.image || (UPGRADE && r.metadata?.imageSubject === 'class'))
    .slice(0, LIMIT)
  const companies = await companyImages()
  console.log(`\nFeed: ${rows.length} rows without a picture (of ${data.length} fetched, ${companies.length} companies with a mark)`)

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
    // A story that names a company we hold a mark for is about that company.
    if (!img) img = matchNamed(row.title, companies)
    let why = ''
    if (!img && !(UPGRADE && row.metadata?.image)) ({ img, why } = classImageFor(row))
    note(row.title || row.id, img, why || 'kept its class photograph')
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
  const rows = data.filter(r => FORCE || !r.metadata?.image || (UPGRADE && r.metadata?.imageSubject === 'class')).slice(0, LIMIT)
  const products = await productImages()
  const makers = await makerSites()
  console.log(`\nTrials: ${rows.length} rows without a picture (${products.length} products with a photograph to reuse)`)

  for (const row of rows) {
    // The product under test, in three ways: a device row we already hold a
    // picture of, the article about it, or its page on the sponsor's own site.
    const named = [row.title, ...(row.metadata?.interventions || [])].join(' ')
    let img = matchNamed(named, products)
    if (!img) img = await resolveTrialImage(row, { sponsorSite: makers.get(normName(row.metadata?.sponsor)) || null })
    let why = ''
    if (!img && !(UPGRADE && row.metadata?.image)) ({ img, why } = classImageFor(row))
    note(row.title || row.id, img, why || 'kept its class photograph')
    if (img) await write('news_feed', row.id, { metadata: { ...(row.metadata || {}), ...toMetadata(img) } })
  }
}

// ── Devices ─────────────────────────────────────────────────────────────────

async function doDevices() {
  const COLS = 'id,name,description,manufacturer,product_code'
  let { data, error } = await sb.from('devices')
    .select(`${COLS},image_url,image_subject`)
    .order('year', { ascending: false, nullsFirst: false })
    .limit(LIMIT * 2)

  // Migration 016 adds the image columns. Until it is applied the resolver can
  // still be exercised, so a dry run shows exactly what the migration would let
  // it write. Committing without the columns is refused rather than attempted.
  let unmigrated = false
  if (error && /image_url|image_subject/.test(error.message)) {
    unmigrated = true
    if (COMMIT) {
      console.error('\ndevices: the image columns do not exist yet.')
      console.error('Apply supabase/migrations/016-entity-images.sql in the Supabase SQL editor, then re-run.')
      return
    }
    console.log('\ndevices: image columns not applied yet, so this is a preview of what would be written.')
    ;({ data, error } = await sb.from('devices').select(COLS)
      .order('year', { ascending: false, nullsFirst: false }).limit(LIMIT * 2))
  }
  if (error) throw error
  const rows = data.filter(r => unmigrated || FORCE || !r.image_url || (UPGRADE && r.image_subject === 'class')).slice(0, LIMIT)
  const sites = await makerSites()
  console.log(`\nDevices: ${rows.length} rows without a picture (${sites.size} makers with a known site)`)

  for (const row of rows) {
    const name = productName(row)
    // The organizations table first, then the maker's own domain worked out
    // from its name and verified against what the site says it is.
    const website = sites.get(normName(row.manufacturer)) || await guessMakerSite(row.manufacturer)
    // Best first: the article about this exact device, then the maker's own
    // product page, then a labelled photograph of the technology.
    let img = await wikipediaImage(name)
    if (!img && website) img = await siteProductImage(website, name)
    let why = ''
    if (!img) ({ img, why } = classImageFor(row, await productCodeText(row.product_code)))
    note(row.name || row.id, img, why || (website ? '' : 'maker site unknown'))
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

// ── Notable research ────────────────────────────────────────────────────────

/**
 * The notable rail lives in a committed JSON file rather than in Postgres, so
 * its pictures are written back into that file. Each entry keeps the column
 * shape the rest of the pipeline uses, which is what lets the page read it
 * without knowing where it came from.
 */
const NOTABLE_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/data/notable.json')

async function doNotable() {
  let rows = []
  try { rows = JSON.parse(readFileSync(NOTABLE_PATH, 'utf8')) } catch { rows = [] }
  const todo = rows.filter(r => FORCE || !r.image_url || (UPGRADE && r.image_subject === 'class'))
  console.log(`\nNotable research: ${todo.length} of ${rows.length} entries without a picture`)

  for (const row of todo) {
    let img = await resolvePaperImage({ url: row.url, metadata: { doi: row.doi, pmid: row.pmid } })
    let why = ''
    if (!img && !(UPGRADE && row.image_url)) {
      ;({ img, why } = classImageFor({ ...row, id: row.doi || row.pmid || row.title }))
    }
    note(row.title || '', img, why || 'kept its class photograph')
    if (img) Object.assign(row, toColumns(img))
  }
  if (COMMIT) {
    writeFileSync(NOTABLE_PATH, JSON.stringify(rows, null, 2) + '\n')
    console.log('  wrote src/data/notable.json')
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(COMMIT ? 'Writing to Supabase.' : 'DRY RUN. Nothing is written. Add --commit to write.')
if (TYPES.has('feed')) await doFeed()
if (TYPES.has('trials')) await doTrials()
if (TYPES.has('devices')) await doDevices()
if (TYPES.has('orgs')) await doOrgs()
if (TYPES.has('notable')) await doNotable()

const total = tally.item + tally.class + tally.none
console.log(`\n● ${tally.item} pictures of the record itself`)
console.log(`○ ${tally.class} labelled class photographs`)
console.log(`· ${tally.none} kept their data figure`)
console.log(`  ${total ? Math.round(((tally.item + tally.class) / total) * 100) : 0}% of ${total} records have a picture`)
if (!COMMIT) console.log('\nDry run. Re-run with --commit to write.')
