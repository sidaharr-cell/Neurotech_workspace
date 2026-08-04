import { describe, it, expect } from 'vitest'
import { imageOf, usableImage, isIllustration, creditLine, fullCredit, needsCredit, assignImages, objectFitOf } from './image'

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

describe('assignImages', () => {
  const withUrl = (id, url) => ({ id, metadata: { image: url, imageSubject: 'class' } })
  // The first entry of the eeg pool, so a repeat can be swapped for the second.
  const POOL_EEG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/EEG_Recording_Cap.jpg/1280px-EEG_Recording_Cap.jpg'

  it('gives the first card the picture it carries', () => {
    const got = assignImages([withUrl('a', 'x.jpg')])
    expect(got.get('a').url).toBe('x.jpg')
  })

  it('hands a repeat a different photograph of the same technology', () => {
    const got = assignImages([withUrl('a', POOL_EEG), withUrl('b', POOL_EEG)])
    expect(got.get('a').url).toBe(POOL_EEG)
    expect(got.get('b')).toBeTruthy()
    expect(got.get('b').url).not.toBe(POOL_EEG)
  })

  it('hands a repeat whose picture belongs to no pool one out of the pool', () => {
    const got = assignImages([withUrl('a', 'x.jpg'), withUrl('b', 'x.jpg')])
    expect(got.get('a').url).toBe('x.jpg')
    expect(got.get('b').url).not.toBe('x.jpg')
    // Whatever it gets is a picture of a technology rather than of the record,
    // which is what obliges the "Illustration" label and the credit line.
    expect(got.get('b').subject).toBe('class')
    expect(got.get('b').license).toBeTruthy()
  })

  it('gives a record with no picture of its own one for what it is about', () => {
    const got = assignImages([{ id: 'a', title: 'A spinal cord stimulator trial for chronic pain', metadata: {} }])
    expect(got.get('a').url).toMatch(/wikimedia/)
    expect(got.get('a').subject).toBe('class')
  })

  it('skips a record with no id rather than keying it as undefined', () => {
    const got = assignImages([{ id: 'a', metadata: {} }, null, { metadata: { image: 'y.jpg' } }])
    expect(got.size).toBe(1)
    expect(got.has(undefined)).toBe(false)
  })
})

describe('assignImages, uniqueness', () => {
  const POOL_EEG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/EEG_Recording_Cap.jpg/1280px-EEG_Recording_Cap.jpg'
  const card = (id, url) => ({ id, metadata: { image: url, imageSubject: 'class' } })

  it('never gives two entries the same picture', () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, POOL_EEG))
    const got = assignImages(cards)
    const urls = [...got.values()].map(i => i.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('falls through to the general pool once the technology runs out', () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, POOL_EEG))
    const got = assignImages(cards)
    expect(got.size).toBeGreaterThan(3)
  })
})

describe('assignImages, the withheld case', () => {
  const POOL_BCI = 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Brain-Computer_Interface_%28BCI%29_-_FET09_Prague.jpg'
  const card = (id, url) => ({ id, metadata: { image: url, imageSubject: 'class' } })

  it('withholds rather than repeats when the pool is exhausted', () => {
    // The pool holds thirty-nine pictures and the page shows fifteen, so this
    // is the case that cannot arise on the page as it stands. It is the rule
    // that matters: a card runs its data figure before it runs a picture the
    // card above it is already showing.
    const cards = Array.from({ length: 60 }, (_, i) => card(`c${i}`, POOL_BCI))
    const got = assignImages(cards)
    const urls = [...got.values()].map(i => i.url)
    expect(new Set(urls).size).toBe(urls.length)
    expect(got.size).toBeLessThan(cards.length)
  })

  it('fills every card on a page the size of the real one', () => {
    const cards = Array.from({ length: 15 }, (_, i) => card(`c${i}`, POOL_BCI))
    expect(assignImages(cards).size).toBe(15)
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
