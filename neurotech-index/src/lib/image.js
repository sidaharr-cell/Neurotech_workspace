/**
 * image.js — reading the image block off a record, whatever shape it is in.
 *
 * Feed rows (news, papers, trials) keep theirs in `metadata` jsonb; devices and
 * organizations keep theirs in columns. Both are written by
 * scripts/backfill-images.js and carry the same fields.
 *
 * `subject` is the field the page has to respect:
 *
 *   'item'   the picture is of this record: a figure from this paper, the
 *            photograph the outlet ran, this company's own logo.
 *   'class'  the picture is a licensed photograph of the TECHNOLOGY, not of
 *            this exact device or trial. It must be labelled "Illustration"
 *            and credited wherever it appears.
 *
 * Older feed rows carry the first vocabulary this pipeline used, where
 * imageKind was 'real' or 'stock' and there was no subject. Those read as
 * item-subject photographs, and a 'stock' one reads as no image at all, which
 * is what it was already treated as.
 */

import CLASS_POOL from '../data/class-images.json'
import IMAGE_FOCUS from '../data/image-focus.json'
import { rankClasses } from './class-match'

const KIND = { real: 'photo' }

/** Which class pool a picture came out of, so a repeat can be swapped for
 *  another photograph of the same technology. */
/**
 * Cards are landscape, and `object-cover` fills the frame by cropping. A tall
 * portrait loses most of its subject to that crop, so where there is a choice
 * the picture closest to the frame's own shape wins.
 */
const CARD_ASPECT = 4 / 3
const fitness = i => Math.abs((i.w || 1) / (i.h || 1) - CARD_ASPECT)
const byFit = (a, b) => fitness(a) - fitness(b)

/**
 * How a picture should sit in its frame: filling it, or shown whole.
 *
 * Every photograph fills its frame. A picture shown whole inside a landscape
 * card is letterboxed, and a portrait letterboxed beside a filled neighbour
 * reads as a vertical picture in a row of horizontal ones — the grid stops
 * looking like a grid. A frame that lets a fifth of its cards out of it is not
 * a frame.
 *
 * This was once conditional: past 1.6x from the card's own shape a picture was
 * shown whole instead, on the reasoning that a tall portrait cropped to 4:3 is
 * a magnified band through the middle. The band is real, and it is the lesser
 * fault, and it is no longer through the middle — the crop is aimed at the
 * subject by scripts/set-image-focus.js. A wide multi-panel figure does lose
 * panels to this, and the card is a way in to the record, not a reading copy
 * of it. Settled 4 Aug 2026: that is accepted, and there is no per-figure
 * exception. Do not reintroduce one.
 *
 * A logo is the one exception: it is a mark on a field, not a picture, and
 * cropping it would cut the wordmark in half.
 */
export const objectFitOf = img => (img?.kind === 'logo' ? 'contain' : 'cover')

/**
 * Whether a picture can be shown large without being enlarged.
 *
 * Mirrors HI_RES in scripts/lib/images.js, which is the bar the pipeline
 * already applies to the lead slot. A picture with no recorded dimensions is
 * not assumed to pass: the stored w and h are what the page has to go on, and
 * guessing in favour of a picture is how a 180px icon ends up four times its
 * size across the measure.
 */
export const isHiRes = img =>
  !!img && Math.max(img.w || 0, img.h || 0) >= 900 && Math.min(img.w || 0, img.h || 0) >= 500

const POOL_BY_URL = new Map(
  Object.entries(CLASS_POOL).flatMap(([classId, c]) => (c.images || []).map(i => [i.url, classId])),
)

/**
 * The best unused photograph in the reviewed pool for this record.
 *
 * Classes are asked in the order rankClasses puts them in — the technologies
 * the record is about, then the ones its facets imply, then the rest — and
 * within a class the picture closest to a card's shape wins. `first` is the
 * class a picture the record ALREADY held came out of, so a story that has to
 * give up a repeated photograph is offered another of its own technology
 * before anything else.
 *
 * Everything here is a licensed photograph a person reviewed, carrying its own
 * credit; it is stamped `'class'` because it is a picture of the technology and
 * not of the record, which is what makes the page label it "Illustration".
 */
function fromPool(entity, used, first = null) {
  for (const id of [first, ...rankClasses(entity)].filter(Boolean)) {
    const pick = (CLASS_POOL[id]?.images || []).filter(i => !used.has(i.url)).sort(byFit)[0]
    if (pick) return { ...pick, subject: 'class' }
  }
  return null
}

/** The image block on a record, or null. */
export function imageOf(entity) {
  if (!entity) return null
  const m = entity.metadata || {}
  if (m.image) {
    return {
      url: m.image,
      kind: KIND[m.imageKind] || m.imageKind || 'photo',
      subject: m.imageSubject || 'item',
      credit: m.imageCredit || null,
      license: m.imageLicense || null,
      licenseUrl: m.imageLicenseUrl || null,
      source: m.imageSource || null,
      sourceUrl: m.imageSourceUrl || null,
      w: m.imageW || null,
      h: m.imageH || null,
    }
  }
  if (entity.image_url) {
    return {
      url: entity.image_url,
      kind: entity.image_kind || 'photo',
      subject: entity.image_subject || 'item',
      credit: entity.image_credit || null,
      license: entity.image_license || null,
      licenseUrl: entity.image_license_url || null,
      source: entity.image_source || null,
      sourceUrl: entity.image_source_url || null,
      w: entity.image_w || null,
      h: entity.image_h || null,
    }
  }
  return null
}

/**
 * The image a slot may show, or null.
 *
 * `own` holds a slot to a picture OF the record. The lead story uses it: a
 * labelled photograph of the technology is a fair illustration on a card in a
 * grid, and the wrong thing to run six columns wide as the day's top story.
 */
export function usableImage(entity, { own = false } = {}) {
  const img = imageOf(entity)
  if (!img || img.kind === 'stock') return null
  // A logo is a mark, not a picture. It says nothing about what a company
  // builds or what a story is about, and a page of them reads as a directory.
  // Records whose only image is a mark show their data figure instead.
  if (img.kind === 'logo') return null
  if (own && img.subject !== 'item') return null
  return img
}

/**
 * Where to crop a picture from.
 *
 * A card is landscape and fills by cropping, and a crop takes the middle,
 * which is wrong whenever the subject is not in the middle: a prosthetic arm
 * along the bottom edge, a patient sitting to one side of a scanner. The
 * focal points are found once by scripts/set-image-focus.js and handed
 * straight to CSS. A picture with no entry is already centred.
 */
export const focusOf = img => (img && IMAGE_FOCUS[img.url]) || '50% 50%'

/**
 * The picture the lead may run, or null.
 *
 * The lead is displayed eleven hundred pixels wide, so it prefers a
 * photograph OF the story and will otherwise take a labelled illustration
 * only when that illustration is large enough not to look soft at that size.
 */
const LEAD_MIN_W = 900

export function leadImage(entity) {
  const own = usableImage(entity, { own: true })
  if (own) return own
  const any = usableImage(entity)
  return (any?.w || 0) >= LEAD_MIN_W ? any : null
}

/** Can this story lead the page? The top slot is the one picture a reader is
 *  certain to see, so a story that cannot fill it does not take it. */
export const canLead = entity => Boolean(leadImage(entity))

/**
 * The picture the lead actually runs: its own, or the one the page assigned it.
 *
 * composeStories tries to lead with a story that brings its own picture, and on
 * a day when none of them can, the lead falls to a story whose picture comes
 * out of the pool like any other card's. The size floor still applies either
 * way, because the frame is eleven hundred pixels wide whatever fills it.
 */
export function leadPicture(entity, assigned) {
  return leadImage(entity) || ((assigned?.w || 0) >= LEAD_MIN_W ? assigned : null)
}

/** Is this a labelled photograph of the technology rather than of the record? */
export const isIllustration = img => img?.subject === 'class'

/**
 * The attribution line. Wikimedia's licences require the author and the
 * licence to be named wherever the picture runs, so a picture whose credit did
 * not survive the pipeline is not shown at all.
 */
/**
 * Where a picture came from, in as few words as a reader needs.
 *
 * Uploaders write whatever they like in the author field: a bare URL, or "My
 * father is the person in the photo. He passed and I found this in his
 * personal photos." Both are honest and neither belongs set in six point type
 * under a news card. So the line under a card names the SOURCE — the archive,
 * the maker's site, the outlet — and the full attribution, author and licence
 * included, stays on the element's title and one click away at the source.
 */
const SOURCE_NAME = {
  commons: 'Wikimedia Commons',
  wikipedia: 'Wikimedia Commons',
  wikidata: 'Wikimedia Commons',
  europepmc: 'Europe PMC',
  biorxiv: 'bioRxiv',
  medrxiv: 'medRxiv',
  arxiv: 'arXiv',
}

const hostOf = url => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

export function sourceName(img) {
  if (!img) return null
  return SOURCE_NAME[img.source]
    || (img.credit && !/\s/.test(img.credit) ? img.credit : null)   // already a domain
    || hostOf(img.sourceUrl)
    || hostOf(img.url)
}

export function creditLine(img) {
  if (!img) return null
  const parts = []
  if (isIllustration(img)) parts.push('Illustration')
  const where = sourceName(img)
  if (where) parts.push(where)
  return parts.length ? parts.join(' · ') : null
}

/** The full attribution, for the element's title. */
export function fullCredit(img) {
  if (!img) return null
  return [isIllustration(img) ? 'Illustration' : null, img.credit, img.license, sourceName(img)]
    .filter(Boolean).join(' · ')
}

/**
 * True when the page must print a credit beside this picture.
 *
 * Everything sourced from somebody else's site is credited: the licence
 * requires it for Commons and for open-access figures, and a manufacturer's
 * product photograph is theirs whether or not it carries a licence. The one
 * exception is the photograph a news outlet published with its own story,
 * because the card already names that outlet on the line below.
 */
export const needsCredit = img => Boolean(creditLine(img))

/**
 * The picture each item on the page will actually run, keyed by id.
 *
 * Two passes, because the page's own photographs come first and what is left of
 * the reviewed pool is then shared out among the cards that have none.
 *
 *   1. A record with a photograph of its own keeps it. A class photograph
 *      belongs to a technology rather than to a record, so eight brain-computer
 *      interface stories would otherwise run the same conference photograph
 *      eight times: the first card keeps it and the rest are re-asked, their
 *      own technology first.
 *   2. Every card still without one takes the best unused photograph in the
 *      pool for what it is about (rankClasses in lib/class-match.js).
 *
 * The second pass is why a card here cannot end up running a plate while the
 * pool still holds a picture. It reaches further than the ingest pipeline will:
 * the photograph is of a technology the record is ABOUT rather than of the
 * record, and past the first few candidates it is of a neighbouring technology.
 * That is a labelled, credited illustration, which is what the `'class'`
 * subject has always meant, and beside a headline it is a better card than a
 * tinted plate carrying an outlet's name. Only the home page's story cards ask
 * for this; nothing else calls assignImages.
 *
 * Nothing is generated at any point. Every picture here is a licensed
 * photograph out of `src/data/class-images.json`, reviewed by a person, run
 * with the credit and licence it arrived with.
 *
 * An item with no id is skipped rather than keyed as undefined, which would
 * let one entry claim another's picture.
 */
export function assignImages(items = []) {
  const used = new Set()
  const out = new Map()
  const unfilled = []
  for (const it of items) {
    if (!it?.id) continue
    const img = usableImage(it)
    if (!img) { unfilled.push(it); continue }
    if (!used.has(img.url)) {
      used.add(img.url)
      out.set(it.id, img)
      continue
    }
    const alt = fromPool(it, used, POOL_BY_URL.get(img.url))
    if (alt) {
      used.add(alt.url)
      out.set(it.id, alt)
    } else {
      unfilled.push(it)
    }
  }
  for (const it of unfilled) {
    const pick = fromPool(it, used)
    if (!pick) continue          // the pool is spent: this card shows its figure
    used.add(pick.url)
    out.set(it.id, pick)
  }
  return out
}
