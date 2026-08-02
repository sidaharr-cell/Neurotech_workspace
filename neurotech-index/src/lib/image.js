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
 * How far a picture can be from the card's shape before cropping it does more
 * harm than letterboxing.
 *
 * Filling a 4:3 card with a tall portrait means showing a narrow band through
 * the middle of it: the subject arrives cropped to the waist and magnified,
 * which reads as a mistake even when the focal point is right. Past this
 * threshold the whole picture is shown instead, centred, on the card's own
 * background.
 */
const MAX_CROP = 1.6

export function fitsFrame(img) {
  if (!img?.w || !img?.h) return true
  const ratio = (img.w / img.h) / CARD_ASPECT
  return ratio <= MAX_CROP && ratio >= 1 / MAX_CROP
}

/** How a picture should sit in its frame: filling it, or shown whole. */
export const objectFitOf = img => (img?.kind === 'logo' || !fitsFrame(img) ? 'contain' : 'cover')

/** There is no general pool to fall back on; see the note in
 *  scripts/lib/images.js. A repeat is offered another photograph of its OWN
 *  technology, and otherwise shows the record's data figure. */
const FALLBACK_CLASS = null

const POOL_BY_URL = new Map(
  Object.entries(CLASS_POOL).flatMap(([classId, c]) => (c.images || []).map(i => [i.url, classId])),
)

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
export const needsCredit = img => Boolean(img && (isIllustration(img) || img.source || img.credit))

/**
 * The picture each item on the page will actually run, keyed by id.
 *
 * A class photograph belongs to a technology, not to a record, so eight
 * brain-computer interface stories would otherwise run the same conference
 * photograph eight times. The first card keeps it. Every card after it is
 * offered a DIFFERENT photograph of the same technology, from the reviewed
 * pool the picture came out of, and only falls back to its data figure once
 * that pool is exhausted.
 *
 * An item with no id is skipped rather than keyed as undefined, which would
 * let one entry claim another's picture.
 */
export function assignImages(items = []) {
  const used = new Set()
  const out = new Map()
  for (const it of items) {
    if (!it?.id) continue
    const img = usableImage(it)
    if (!img) continue
    if (!used.has(img.url)) {
      used.add(img.url)
      out.set(it.id, img)
      continue
    }
    // Its own technology first, then the general one. A record about
    // microelectrode arrays, which nobody has photographed for Commons, is
    // still a record about the nervous system, and a brain is a fair
    // illustration of that. Nothing borrows a picture of a DIFFERENT
    // technology: that would be a claim, not an illustration.
    const alt = [POOL_BY_URL.get(img.url), FALLBACK_CLASS].filter(Boolean)
      .flatMap(id => CLASS_POOL[id]?.images || [])
      .filter(a => !used.has(a.url))
      .sort(byFit)[0]
    if (alt) {
      used.add(alt.url)
      out.set(it.id, { ...alt, subject: 'class' })
    }
  }
  return out
}
