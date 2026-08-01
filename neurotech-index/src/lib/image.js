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

const KIND = { real: 'photo' }

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
  if (own && img.subject !== 'item') return null
  return img
}

/** Is this a labelled photograph of the technology rather than of the record? */
export const isIllustration = img => img?.subject === 'class'

/**
 * The attribution line. Wikimedia's licences require the author and the
 * licence to be named wherever the picture runs, so a picture whose credit did
 * not survive the pipeline is not shown at all.
 */
export function creditLine(img) {
  if (!img) return null
  const parts = []
  if (isIllustration(img)) parts.push('Illustration')
  if (img.credit) parts.push(img.credit)
  if (img.license) parts.push(img.license)
  return parts.length ? parts.join(' · ') : null
}

/** True when the page must print a credit beside this picture: anything
 *  licensed, and every illustration whether licensed or not. */
export const needsCredit = img => Boolean(img && (img.license || isIllustration(img)))

/**
 * The ids whose picture repeats one already used earlier on the page.
 *
 * Class photographs are shared by every record of a technology, so a page of
 * eight brain-computer interface stories would otherwise run the same
 * conference photograph eight times. The first card keeps it; the rest fall
 * back to their data figure, which is the more informative picture anyway.
 */
export function duplicateImageIds(items = []) {
  const seen = new Set()
  const dupes = new Set()
  for (const it of items) {
    if (!it) continue
    const img = usableImage(it)
    if (!img) continue
    if (seen.has(img.url)) dupes.add(it.id)
    else seen.add(img.url)
  }
  return dupes
}
