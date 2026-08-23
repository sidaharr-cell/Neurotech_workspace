import { describe, it, expect } from 'vitest'
import { imageOf, usableImage, isIllustration, creditLine, fullCredit, needsCredit, assignImages, objectFitOf, canLead, leadPicture } from './image'
import { keyOf } from './ledger'

const feedRow = (over = {}) => ({ id: 'f1', metadata: { image: 'https://x/a.jpg', ...over } })
const deviceRow = (over = {}) => ({ id: 'd1', image_url: 'https://x/b.jpg', image_source: 'commons', ...over })

describe('imageOf', () => {
  it('reads a feed row out of metadata', () => {
    const img = imageOf(feedRow({ imageKind: 'photo', imageSubject: 'class', imageCredit: 'A Photographer', imageLicense: 'CC BY 4.0' }))
    expect(img).toMatchObject({ url: 'https://x/a.jpg', subject: 'class', credit: 'A Photographer', license: 'CC BY 4.0' })
  })

  it('reads a device row out of its columns', () => {
    expect(imageOf(deviceRow({ image_subject: 'class', image_license: 'CC BY-SA 3.0' })))
      .toMatchObject({ url: 'https://x/b.jpg', subject: 'class', license: 'CC BY-SA 3.0' })
  })

  it('reads the pipeline\'s first vocabulary as an item photograph', () => {
    expect(imageOf(feedRow({ imageKind: 'real' }))).toMatchObject({ kind: 'photo', subject: 'item' })
  })

  it('is null for a record with no picture', () => {
    expect(imageOf({ id: 'x', metadata: {} })).toBeNull()
    expect(imageOf(null)).toBeNull()
  })
})

describe('usableImage', () => {
  it('never shows an image the vision pass called stock', () => {
    expect(usableImage(feedRow({ imageKind: 'stock' }))).toBeNull()
  })

  it('holds the lead to a picture of the story itself', () => {
    const illustration = feedRow({ imageSubject: 'class' })
    expect(usableImage(illustration)).toBeTruthy()
    expect(usableImage(illustration, { own: true })).toBeNull()
    expect(usableImage(feedRow({ imageSubject: 'item' }), { own: true })).toBeTruthy()
  })
})

describe('creditLine', () => {
  it('names the archive rather than an uploader\'s essay', () => {
    const img = imageOf(feedRow({
      imageSubject: 'class', imageSource: 'commons',
      imageCredit: 'My father is the person in the photo. He passed and I found this', imageLicense: 'CC0',
    }))
    expect(creditLine(img)).toBe('Illustration · Wikimedia Commons')
    // the whole attribution survives, on the title
    expect(fullCredit(img)).toContain('My father is the person')
    expect(fullCredit(img)).toContain('CC0')
  })

  it('names a maker by its site', () => {
    const img = imageOf(feedRow({ imageSubject: 'item', imageSource: 'manufacturer', imageCredit: 'calahealth.com' }))
    expect(creditLine(img)).toBe('calahealth.com')
  })

  it('names the outlet that ran a story photograph', () => {
    // A one-word credit is already the outlet's name, and reads better than
    // its domain. A credit that is a sentence is not, and falls back to the host.
    expect(creditLine(imageOf(feedRow({ imageSubject: 'item', imageSource: 'og', imageCredit: 'Reuters' })))).toBe('Reuters')
    expect(creditLine(imageOf(feedRow({
      imageSubject: 'item', imageSource: 'og', imageCredit: 'Photograph by staff',
      imageSourceUrl: 'https://www.manilatimes.net/a/b',
    })))).toBe('manilatimes.net')
  })

  it('says an illustration is one', () => {
    expect(isIllustration(imageOf(feedRow({ imageSubject: 'class' })))).toBe(true)
  })

  it('asks for a source line on every picture', () => {
    expect(needsCredit(imageOf(feedRow({ imageSubject: 'item', imageSource: 'og', imageCredit: 'Reuters' })))).toBe(true)
    expect(needsCredit(imageOf(feedRow({ imageSubject: 'class', imageSource: 'commons' })))).toBe(true)
  })
})

describe('assignImages: a photograph of the story, or nothing', () => {
  // Big enough for a card. Anything smaller is a separate rule, tested below.
  const shot = (id, url, over = {}) =>
    ({ id, metadata: { image: url, imageSubject: 'item', imageW: 1600, imageH: 1200, ...over } })

  it('gives a card the photograph it brought with it', () => {
    expect(assignImages([shot('a', 'https://x/a.jpg')]).get('a').url).toBe('https://x/a.jpg')
  })

  // The reversal of 4 Aug 2026. A card with no photograph of its own used to
  // be handed a reviewed photograph of the technology it was about, or of a
  // neighbouring one. It now shows its data figure, which is what an absent
  // entry in this map means.
  it('gives a card with no photograph of its own nothing', () => {
    const got = assignImages([{ id: 'a', title: 'A spinal cord stimulator trial for chronic pain', metadata: {} }])
    expect(got.has('a')).toBe(false)
  })

  it('will not run a photograph of the technology rather than of the story', () => {
    const got = assignImages([shot('a', 'https://x/a.jpg', { imageSubject: 'class' })])
    expect(got.has('a')).toBe(false)
  })

  it('will not run a logo or anything the vision pass called stock', () => {
    expect(assignImages([shot('a', 'https://x/a.jpg', { imageKind: 'logo' })]).has('a')).toBe(false)
    expect(assignImages([shot('a', 'https://x/a.jpg', { imageKind: 'stock' })]).has('a')).toBe(false)
  })

  it('skips a record with no id rather than keying it as undefined', () => {
    const got = assignImages([{ id: 'a', metadata: {} }, null, { metadata: { image: 'y.jpg' } }])
    expect(got.size).toBe(0)
    expect(got.has(undefined)).toBe(false)
  })
})

describe('assignImages: high resolution or the data figure', () => {
  const at = (w, h) => ({ id: 'a', metadata: { image: 'https://x/a.jpg', imageSubject: 'item', imageW: w, imageH: h } })

  it('runs a picture that clears the frame at 2x', () => {
    expect(assignImages([at(1600, 1200)]).has('a')).toBe(true)
    expect(assignImages([at(884, 560)]).has('a')).toBe(true)     // a real arXiv figure
  })

  it('will not enlarge a small picture to fill a card', () => {
    expect(assignImages([at(640, 480)]).has('a')).toBe(false)
    expect(assignImages([at(766, 512)]).has('a')).toBe(false)    // 34 pixels short
  })

  it('will not run a banner that is wide and nothing else', () => {
    expect(assignImages([at(2400, 320)]).has('a')).toBe(false)
  })

  // Guessing in favour of a picture is how a thumbnail ends up four times its
  // size across a card, so an unmeasured picture does not pass.
  it('does not assume a picture with no recorded size is big enough', () => {
    expect(assignImages([{ id: 'a', metadata: { image: 'https://x/a.jpg', imageSubject: 'item' } }]).has('a')).toBe(false)
  })
})

describe('assignImages: one photograph, one story', () => {
  const shot = (id, url) => ({ id, metadata: { image: url, imageSubject: 'item', imageW: 1600, imageH: 1200 } })
  const WIRE = 'https://cdn.wire.example/photo.jpg'

  it('never gives two cards on the page the same picture', () => {
    // Two syndications of the same wire copy, carrying the same og:image.
    const got = assignImages([shot('a', WIRE), shot('b', WIRE)])
    expect(got.get('a').url).toBe(WIRE)
    expect(got.has('b')).toBe(false)
  })

  it('leaves a picture alone once the ledger has promised it to another story', () => {
    const ledger = { bindings: { [keyOf(WIRE)]: { item: 'ran-in-march', url: WIRE } }, leads: [] }
    expect(assignImages([shot('today', WIRE)], { ledger }).has('today')).toBe(false)
  })

  it('gives a story back the picture the ledger already bound to it', () => {
    const ledger = { bindings: { [keyOf(WIRE)]: { item: 'a', url: WIRE } }, leads: [] }
    expect(assignImages([shot('a', WIRE)], { ledger }).get('a').url).toBe(WIRE)
  })

  // The size the file is served at is not what makes it a different picture.
  it('recognises the same Wikimedia file re-sourced at a larger width', () => {
    const small = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Cap.jpg/1280px-Cap.jpg'
    const large = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Cap.jpg/2000px-Cap.jpg'
    const ledger = { bindings: { [keyOf(small)]: { item: 'older', url: small } }, leads: [] }
    expect(assignImages([shot('newer', large)], { ledger }).has('newer')).toBe(false)
  })
})

describe('the lead', () => {
  const shot = (w, h) => ({ id: 'a', metadata: { image: 'https://x/a.jpg', imageSubject: 'item', imageW: w, imageH: h } })

  it('needs a picture wide enough for a frame eleven hundred pixels across', () => {
    expect(canLead(shot(1600, 1200))).toBe(true)
    expect(canLead(shot(1000, 750))).toBe(false)
  })

  it('takes a photograph of the story or nothing', () => {
    const illustrated = { id: 'a', metadata: { image: 'https://x/a.jpg', imageSubject: 'class', imageW: 2000, imageH: 1500 } }
    expect(canLead(illustrated)).toBe(false)
    expect(leadPicture(illustrated, undefined)).toBeNull()
  })

  // The page withholding a picture is the ledger speaking. The lead has to
  // hear it, or the one card that ignores the rule is the biggest one.
  it('honours a picture the page withheld', () => {
    expect(leadPicture(shot(1600, 1200), null)).toBeNull()
    expect(leadPicture(shot(1600, 1200), undefined).url).toBe('https://x/a.jpg')
  })
})

describe('every photograph fills its frame', () => {
  it('fills the card with a picture near its shape', () => {
    expect(objectFitOf({ w: 1280, h: 960 })).toBe('cover')
    expect(objectFitOf({ w: 1280, h: 720 })).toBe('cover')
  })

  it('crops a tall portrait rather than letterboxing it in a landscape card', () => {
    expect(objectFitOf({ w: 766, h: 1707 })).toBe('cover')
    expect(objectFitOf({ w: 1200, h: 1600 })).toBe('cover')
  })

  it('crops a very wide picture too', () => {
    expect(objectFitOf({ w: 1280, h: 400 })).toBe('cover')
  })

  it('does not let a missing dimension change how a picture sits', () => {
    expect(objectFitOf({ url: 'https://x/a.jpg' })).toBe('cover')
  })

  it('never crops a logo', () => {
    expect(objectFitOf({ kind: 'logo', w: 1280, h: 960 })).toBe('contain')
  })
})

describe('logos are not pictures', () => {
  it('refuses a company mark as a card picture', () => {
    expect(usableImage({ id: 'x', image_url: 'https://x/logo.png', image_kind: 'logo' })).toBeNull()
  })

  it('still accepts a photograph from the same company', () => {
    expect(usableImage({ id: 'x', image_url: 'https://x/lab.jpg', image_kind: 'photo' })).toBeTruthy()
  })
})

describe('legacy rows still name their source', () => {
  it('derives the outlet from the image host when the row predates source stamping', () => {
    const legacy = { id: 'x', metadata: { image: 'https://manilatimes.net/uploads/2026/1154690.jpg', imageKind: 'real' } }
    const img = imageOf(legacy)
    expect(creditLine(img)).toBe('manilatimes.net')
    expect(needsCredit(img)).toBe(true)
  })
})
