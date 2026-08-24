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
 *
 * **The home page takes 'item' and nothing else.** It used to spend the
 * reviewed class pool against its story cards, so a card whose own technology
 * had no photograph ran a labelled photograph of a NEIGHBOURING technology
 * rather than a data figure. Settled 23 Aug 2026, reversing the 4 Aug
 * decision: a photograph beside a headline is read as a photograph OF that
 * story, and the "Illustration" label is a caption a reader skims past. A
 * figure of the record's own numbers claims only what the record says. Class
 * photographs are still right on the section pages, where the card is a row in
 * a directory of a technology rather than a story; assignImages is the home
 * page's function and only the home page calls it.
 */

import IMAGE_FOCUS from '../data/image-focus.json'
import LEDGER from '../data/image-ledger.json'
import { isFree, keyOf } from './ledger'

const KIND = { real: 'photo' }

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
  // 'stock' is a picture the vision pass called decoration. 'motif' is older
  // still: the generated placeholder art this project used before it settled
  // on "a picture is a photograph somebody took, or it is a figure of the
  // record's own numbers". Neither is a picture, and a row carrying either
  // shows its data figure.
  if (!img || img.kind === 'stock' || img.kind === 'motif') return null
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
 * High enough resolution to run on the home page.
 *
 * "High resolution" is not a number somebody liked. It is the frame the
 * picture actually lands in, times the pixel ratio it is viewed at, plus what
 * the crop throws away. The frames, measured off the layout in
 * MagazineFeed.jsx against the 1320px measure defined in index.css:
 *
 *   lead      the lead column is 8 of 12 with a 40px gap (~853px), and the
 *             picture is 3 of its 5 columns: **~512 CSS px**. Not the 1100
 *             the old comments here claimed — that was a layout ago, and the
 *             floor derived from it was being applied to a frame less than
 *             half the size.
 *   featured  four across the measure: **~310 CSS px**.
 *   latest    five across: **~250 CSS px**.
 *
 * At a 2x device pixel ratio those want 1024, 620 and 500 real pixels. So:
 *
 *   STORY_MIN_W = 700    the largest CARD frame at 2x (620), plus a margin for
 *                        the crop, since `object-fit: cover` throws away part
 *                        of one axis on top of the scaling. It was 800 for a
 *                        day, which was that same 620 rounded up generously
 *                        rather than derived, and the rounding cost real
 *                        coverage: eight of the twenty pictures in the whole
 *                        index sit between 600 and 800 on the long edge, most
 *                        of them the 766x512 that one trade title publishes
 *                        everything at. 766 across a 620-pixel frame is not a
 *                        picture being enlarged. 800 was.
 *   LEAD_MIN_W  = 1200   the lead frame at 2x, same margin. Unchanged: the
 *                        lead is 1024 real pixels and a 766 there IS enlarged.
 *
 * The short-edge floor is what keeps a banner out: a 2000x300 strip passes any
 * long-edge test and is a letterbox of nothing once cropped to 4:3.
 *
 * Keep these in step with CARD_RES and HI_RES in scripts/lib/images.js, which
 * are the pipeline's copies. A picture sourced below the page's floor is
 * stored and then never rendered, which reads in the database as coverage the
 * page does not have.
 */
export const STORY_MIN_W = 700
export const STORY_MIN_H = 400
export const LEAD_MIN_W = 1200

const bigEnough = (img, minW = STORY_MIN_W) =>
  !!img && Math.max(img.w || 0, img.h || 0) >= minW && Math.min(img.w || 0, img.h || 0) >= STORY_MIN_H

/**
 * The picture a home-page story card may run, or null.
 *
 * Three gates, and a card that fails any of them shows its data figure:
 *
 *   of the story   `own: true`. See the note at the top of this file. A
 *                  photograph of a neighbouring technology is not a photograph
 *                  of this story.
 *   large enough   bigEnough. A picture enlarged to fill its frame is worse
 *                  than no picture, and the pipeline is asked for files that
 *                  clear the frame rather than files that merely exist.
 *   unspent        checked by the caller against the ledger, because it is a
 *                  fact about the page and not about the record.
 */
export function storyImage(entity) {
  const img = usableImage(entity, { own: true })
  return bigEnough(img) ? img : null
}

/**
 * The picture the lead may run, or null.
 *
 * The lead is displayed eleven hundred pixels wide and is the one picture a
 * reader is certain to see. It takes a photograph OF the story or it takes
 * nothing: there is no fallback to a labelled illustration any more, and there
 * is no fallback to a picture the page assigned from a pool, because there is
 * no pool.
 */
export function leadImage(entity) {
  const own = usableImage(entity, { own: true })
  return bigEnough(own, LEAD_MIN_W) ? own : null
}

/** Can this story lead the page? The top slot is the one picture a reader is
 *  certain to see, so a story that cannot fill it does not take it. */
export const canLead = entity => Boolean(leadImage(entity))

/**
 * The picture the lead actually runs.
 *
 * `assigned` is what assignImages gave the lead, which is the same photograph
 * leadImage would find, minus any the ledger has already promised elsewhere.
 * Honouring it is what stops the lead re-running a picture the page withheld
 * from it. The size floor applies either way, because the frame is eleven
 * hundred pixels wide whatever fills it.
 */
export function leadPicture(entity, assigned) {
  // `undefined` still means "nobody has decided, work it out"; `null` means the
  // page withheld a picture, and honouring that is what stops the lead running
  // a photograph the ledger promised to a different story.
  const img = assigned === undefined ? leadImage(entity) : assigned
  return bigEnough(img, LEAD_MIN_W) ? img : null
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
 * A card is in the map when it has a photograph of its own, big enough for the
 * frame, that no other story has ever been given. A card that is not in the
 * map shows the data figure built out of its own fields — that is a normal
 * outcome, not a failure, and on a thin day several cards will take it.
 *
 * The two rules being kept:
 *
 *   of the story    storyImage above. Nothing here reaches for a photograph of
 *                   the technology, a neighbouring technology, or anything
 *                   else the record did not bring with it. There is no pool to
 *                   reach into any more.
 *
 *   never twice     enforced in two places at once, because they are two
 *                   different claims. `seen` is this render: two stories
 *                   syndicated from the same wire copy carry the same
 *                   og:image, and the first one asked keeps it. The ledger is
 *                   every render there has ever been: a picture that ran beside
 *                   a story in March is that story's, and a story that meets it
 *                   in November shows its figure instead.
 *
 * Nothing is written here. The page is read-only — Supabase is anon and there
 * is no server — so the binding is made by scripts/bind-home-images.js in the
 * daily run and committed as src/data/image-ledger.json. Between runs the page
 * enforces the rule against the ledger it was built with, and the day's new
 * pictures are unbound, which is why `seen` has to do the same job locally.
 *
 * An item with no id is skipped rather than keyed as undefined, which would let
 * one entry claim another's picture.
 */
export function assignImages(items = [], { ledger = LEDGER } = {}) {
  const seen = new Set()
  const out = new Map()
  for (const it of items) {
    if (!it?.id) continue
    const img = storyPicture(it, { ledger })
    if (!img) continue
    const key = keyOf(img.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.set(it.id, img)
  }
  return out
}

/**
 * The picture ONE story may show, asked outside the page's assignment.
 *
 * The story page (`/item/:id`) uses this. It has to reach the same answer the
 * home page reached, or a reader who clicks a card showing a data figure lands
 * on a page showing a photograph that the ledger has promised to somebody
 * else, which is the rule broken in the one place a reader is looking hardest.
 *
 * The only rule assignImages holds that this cannot is "not twice on this
 * page", and a page showing one story has no such page to clash with.
 */
export function storyPicture(entity, { ledger = LEDGER } = {}) {
  const img = storyImage(entity)
  if (!img || !entity?.id) return null
  return isFree(ledger, img.url, entity.id) ? img : null
}
