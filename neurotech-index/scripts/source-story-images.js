/**
 * source-story-images.js — find each home-page story a photograph OF ITSELF.
 *
 *   node --env-file-if-exists=.env scripts/source-story-images.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/source-story-images.js --commit
 *
 * This replaces fill-page-images.js, which filled a blank frame with a
 * reviewed photograph of the technology the story was about — or, once those
 * ran out, of a neighbouring technology — captioned "Illustration". That was
 * the right call for a card in a directory of a technology and the wrong one
 * for a card in a news feed: a photograph beside a headline is read as a
 * photograph of that story, and a caption is not a disclaimer a reader reads.
 *
 * So the only pictures this looks for are the story's own, in the order they
 * are worth having:
 *
 *   1. the paper's OWN figure, from bioRxiv, medRxiv, arXiv, or Europe PMC
 *      when the article is open access and its licence allows reuse. A figure
 *      has to be ONE panel — Figure 1 is nearly always a composite of lettered
 *      sub-figures, which at card size is grey noise — so the walk goes down
 *      the figure list until it finds one, rather than taking the first.
 *   2. the photograph the outlet published with the story, from its own page.
 *      Most of these arrive at ingest; this is the retry for the rows where
 *      the fetch failed or the page had not rendered its meta tags yet.
 *
 * Everything found is stamped subject='item', because it IS the record: this
 * paper's figure, this outlet's photograph. Nothing here can produce a 'class'
 * picture, which is the property that makes the home page's rule hold.
 *
 * Three gates every candidate passes, and there is no path around any of them:
 *
 *   licence     open-access and reusable, or it is not ours to publish
 *               (isReusableLicense). A paywalled paper simply has no figure.
 *   size        CARD_RES, which is the size the frame needs at 2x rather than
 *               a number somebody liked. See scripts/lib/images.js.
 *   reviewed    somebody has looked at it and said yes. An unreviewed picture
 *               is rejected and queued, so it is available tomorrow. No script
 *               in this repo calls a model; see scripts/lib/review.js.
 *
 * And one that is about the page rather than the picture: a photograph the
 * ledger has already promised to a different story is not offered to this one
 * (src/lib/ledger.js). Sourcing it would only mean assignImages withholding it
 * at render time, and the record would sit there holding a picture it can
 * never show.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { resolvePaperImage, ogImage, isAggregator, measureImage, CARD_RES, flushQueue, queueCandidate } from './lib/images.js'
import { load as loadReview, approved, decided } from './lib/review.js'
import { ownerOf } from '../src/lib/ledger.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMMIT = process.argv.includes('--commit')
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 30)
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const ledger = JSON.parse(readFileSync(join(HERE, '../src/data/image-ledger.json'), 'utf8'))
const review = loadReview()

/** Is this picture free, reviewed and big enough to be worth storing? */
async function acceptable(url, row, why) {
  if (!url) return null
  const owner = ownerOf(ledger, url)
  if (owner && owner !== row.id) return { reject: 'held by another story' }
  const dims = await measureImage(url)
  if (!CARD_RES(dims)) return { reject: dims ? `too small (${dims.width}x${dims.height})` : 'unreadable' }
  if (!decided(review, url)) {
    queueCandidate(url, { item: row.id, title: String(row.title || '').slice(0, 80), why })
    return { reject: 'queued for review' }
  }
  if (!approved(review, url)) return { reject: 'reviewed and turned down' }
  return { dims }
}

/**
 * The stamp written onto a feed row.
 *
 * `imageSubject` is always 'item' here, and that is the whole point of this
 * script. `imageCheckedAt` is what verify-images.js ages out.
 */
const stamp = (img, dims) => ({
  image: img.url,
  imageKind: img.kind || 'photo',
  imageSubject: 'item',
  imageCredit: img.credit || null,
  imageLicense: img.license || null,
  imageLicenseUrl: img.licenseUrl || null,
  imageSource: img.source || null,
  imageSourceUrl: img.sourceUrl || null,
  imageW: dims.width,
  imageH: dims.height,
  imageCheckedAt: new Date().toISOString(),
})

// ── The stories the home page will show ─────────────────────────────────────
//
// getNewsFeed in src/lib/data.js, restated. This script is plain node and that
// module is Vite-resolved (extensionless imports, JSON imports), so it cannot
// simply be called the way bind-home-images.js calls it — but the ordering has
// to be the same or this sources pictures for rows the page never shows.
//
// It is NOT `order by relevance_score limit 120`, which is what this used to
// do. It is: a recency window four times the size of the slot, re-sorted by
// the rankScore inside the metadata blob (jsonb, unindexed, so the sort is
// done here rather than in Postgres), cut to the limit, and then every
// photograph-bearing story below the cut appended so the feed has pictures to
// feature. Keep the three copies of this in step.
const LIMIT_ROWS = 120
const { data: window_, error } = await sb.from('news_feed')
  // relevance_score is selected because the rank below falls back to it for
  // legacy rows with no rankScore. Omitting it made those rows rank 0 here and
  // non-zero on the page, which is a different ordering by another name.
  .select('id,title,url,entry_type,published_at,relevance_score,metadata')
  .neq('entry_type', 'trial')
  .order('published_at', { ascending: false, nullsFirst: false })
  .limit(Math.max(400, LIMIT_ROWS * 4))
if (error) { console.error('feed query failed:', error.message); process.exit(1) }

const rank = r => (r.metadata?.rankScore ?? (r.relevance_score ?? 0) / 10)
const sorted = [...(window_ || [])].sort((a, b) => rank(b) - rank(a))
const top = sorted.slice(0, LIMIT_ROWS)
const inTop = new Set(top)
// The photograph tail: a story the page will show BECAUSE it has a picture.
const feed = [...top, ...sorted.slice(LIMIT_ROWS).filter(r => !inTop.has(r) && pageWouldShow(r))]

/**
 * Does this row already hold a picture the home page may run?
 *
 * A STORED picture has to clear the same gates as a new one, including the
 * review. It used to be enough that a row had an item picture from some
 * earlier run, and that is how two unreviewed pictures reached the front page
 * on 23 Aug 2026: an arXiv figure that turned out to be an electrode-montage
 * schematic with a legend nobody could read at card size, and a local TV
 * frame-grab carrying the station's chyron, its logo and a bankruptcy
 * attorney's advert burned into the bottom third.
 *
 * Neither was a bug in the sourcing. Both were sourced before the review
 * existed and then never asked about again, and "already has one" is exactly
 * the condition under which nobody looks. So the check runs over what is
 * stored too, and an unreviewed stored picture is queued like any other.
 */
/**
 * Would the PAGE run this row's stored picture?
 *
 * Everything holds() asks except the review. This is the predicate getNewsFeed
 * appends its photograph tail with (hasRealImage in src/lib/sources.js), so it
 * is what decides whether a story below the rank cut appears at all — and it
 * has to be asked here separately, because using holds() for the tail excluded
 * precisely the rows that needed clearing. A story whose picture had been
 * reviewed and REJECTED still reached the page on the strength of that
 * picture, and this script could not see it to clear it.
 */
function pageWouldShow(row) {
  const m = row.metadata || {}
  if (!m.image) return false
  if ((m.imageSubject || 'item') !== 'item') return false
  if (m.imageKind === 'logo' || m.imageKind === 'stock' || m.imageKind === 'motif') return false
  return CARD_RES({ width: m.imageW || 0, height: m.imageH || 0 })
}

function holds(row) {
  const m = row.metadata || {}
  if (!m.image) return false
  // Read the way imageOf in src/lib/image.js reads: a row written before the
  // subject vocabulary existed has no imageSubject, and the PAGE treats that as
  // an item photograph. Testing `m.imageSubject !== 'item'` instead meant those
  // rows fell out of this function before the review check below, so the
  // pipeline never queued them and the page went on showing them. Three
  // unreviewed pictures were on the home page that way.
  const subject = m.imageSubject || 'item'
  if (subject !== 'item') return false                                 // a class picture: the home page will not run it
  if (m.imageKind === 'logo' || m.imageKind === 'stock' || m.imageKind === 'motif') return false
  // Asked through the same gate the sourcing uses, so "usable" means one thing
  // in this file. A row below the floor holds a picture the page never renders.
  if (!CARD_RES({ width: m.imageW || 0, height: m.imageH || 0 })) return false
  if (!decided(review, m.image)) {
    queueCandidate(m.image, { item: row.id, title: String(row.title || '').slice(0, 80), why: 'already on the page, never reviewed' })
    return false
  }
  return approved(review, m.image)
}

const needs = (feed || []).filter(r => !holds(r)).slice(0, LIMIT)

console.log(`${feed?.length || 0} stories in the page's pool, ${needs.length} without a usable photograph of their own\n`)

let found = 0, queued = 0, cleared = 0
const misses = []

for (const row of needs) {
  const label = String(row.title || '').slice(0, 56).padEnd(58)
  let got = null, reason = 'nothing found'

  // 1. The paper's own figure. resolvePaperImage walks bioRxiv/medRxiv, arXiv
  //    and Europe PMC, and refuses anything whose licence does not allow reuse.
  if (row.entry_type === 'paper' || row.entry_type === 'preprint') {
    const fig = await resolvePaperImage(row)
    if (fig) {
      const verdict = await acceptable(fig.url, row, 'a figure from this paper')
      if (verdict?.dims) got = { img: fig, dims: verdict.dims }
      else reason = verdict?.reject || reason
    } else {
      reason = 'no open-access figure'
    }
  }

  // 2. The photograph the outlet ran with the story, off its own page.
  if (!got && row.url) {
    const og = await ogImage(row.url)
    if (og) {
      const verdict = await acceptable(og, row, 'the photograph this outlet ran')
      if (verdict?.dims) {
        got = {
          img: {
            url: og,
            kind: 'photo',
            credit: (() => { try { return new URL(row.url).hostname.replace(/^www\./, '') } catch { return null } })(),
            license: null,
            licenseUrl: null,
            source: 'publisher',
            sourceUrl: row.url,
          },
          dims: verdict.dims,
        }
      } else {
        reason = verdict?.reject || reason
      }
    } else if (reason === 'nothing found') {
      // Two different nothings, and the distinction is the whole diagnosis.
      //
      // An aggregator copy has no photograph of its own to give: its og:image
      // is the aggregator's logo. Nothing here can fix that, and the count is
      // what tells you how much of the feed is arriving through a wrapper.
      //
      // A publisher that will not answer is Wiley, Science or Nature returning
      // a 403 or a login redirect to any script. There is no photograph to be
      // had for those until the article reaches PMC.
      reason = isAggregator(row.url)
        ? 'an aggregator copy, which has no photograph of its own'
        : 'the publisher page would not answer'
    }
  }

  if (!got) {
    if (reason === 'queued for review') queued++
    misses.push([row.title, reason])
    console.log(`  ·  ${label} ${reason}`)
    // A stored picture the review turned down is cleared rather than left in
    // place. Left there it is invisible on the home page but still live on the
    // section pages and the story page, which read the record directly.
    if (COMMIT && row.metadata?.image && decided(review, row.metadata.image) && !approved(review, row.metadata.image)) {
      const { image, imageKind, imageSubject, imageCredit, imageLicense, imageLicenseUrl,
        imageSource, imageSourceUrl, imageW, imageH, imageCheckedAt, ...rest } = row.metadata
      void [image, imageKind, imageSubject, imageCredit, imageLicense, imageLicenseUrl,
        imageSource, imageSourceUrl, imageW, imageH, imageCheckedAt]
      await sb.from('news_feed').update({ metadata: rest }).eq('id', row.id)
      cleared++
    }
    continue
  }

  found++
  console.log(`  ●  ${label} ${got.img.source}  ${got.dims.width}x${got.dims.height}`)
  if (COMMIT) {
    await sb.from('news_feed')
      .update({ metadata: { ...(row.metadata || {}), ...stamp(got.img, got.dims) } })
      .eq('id', row.id)
  }
}

// Every candidate this run met and had no ruling on, written once so the daily
// reviewer has a work list and tomorrow's run can use what it decides.
const newlyQueued = flushQueue()

console.log(`\n${found} stor${found === 1 ? 'y' : 'ies'} given a photograph of their own, ${cleared} stored picture(s) cleared as unpublishable`)
console.log(`${newlyQueued} picture(s) newly queued for review (${queued} of the misses above are waiting on one)`)
if (misses.length) {
  const byReason = misses.reduce((m, [, r]) => ({ ...m, [r]: (m[r] || 0) + 1 }), {})
  for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${r}`)
}
if (!COMMIT) console.log('\nDry run. Re-run with --commit to write.')
