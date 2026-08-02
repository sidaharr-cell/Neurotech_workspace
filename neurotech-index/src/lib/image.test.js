import { describe, it, expect } from 'vitest'
import { imageOf, usableImage, isIllustration, creditLine, needsCredit, assignImages } from './image'

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
  it('says an illustration is one, and names the author and licence', () => {
    const img = imageOf(feedRow({ imageSubject: 'class', imageCredit: 'Jane Doe', imageLicense: 'CC BY-SA 4.0' }))
    expect(creditLine(img)).toBe('Illustration · Jane Doe · CC BY-SA 4.0')
    expect(isIllustration(img)).toBe(true)
  })

  it('credits a licensed figure without calling it an illustration', () => {
    const img = imageOf(feedRow({ imageSubject: 'item', imageCredit: 'Card NS et al., Nature medicine, 2026', imageLicense: 'cc by' }))
    expect(creditLine(img)).toBe('Card NS et al., Nature medicine, 2026 · cc by')
  })

  it('asks for no credit line on an outlet photograph the card already sources', () => {
    expect(needsCredit(imageOf(feedRow({ imageSubject: 'item', imageSource: 'og', imageCredit: 'Reuters' })))).toBe(false)
  })

  it("credits a maker's product photograph, licence or no licence", () => {
    const img = imageOf(feedRow({ imageSubject: 'item', imageSource: 'manufacturer', imageCredit: 'calahealth.com' }))
    expect(needsCredit(img)).toBe(true)
    expect(creditLine(img)).toBe('calahealth.com')
  })

  it('always asks for one on an illustration, licence or not', () => {
    expect(needsCredit(imageOf(feedRow({ imageSubject: 'class' })))).toBe(true)
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

  it('withholds from a repeat whose picture belongs to no pool', () => {
    // There is no general pool to reach for, by design: see the note in
    // scripts/lib/images.js. The second card shows its data figure.
    const got = assignImages([withUrl('a', 'x.jpg'), withUrl('b', 'x.jpg')])
    expect(got.get('a').url).toBe('x.jpg')
    expect(got.has('b')).toBe(false)
  })

  it('skips records with no picture and no id', () => {
    expect(assignImages([{ id: 'a', metadata: {} }, null, { metadata: { image: 'y.jpg' } }]).size).toBe(0)
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
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, POOL_BCI))
    const got = assignImages(cards)
    const urls = cards.map(c => got.get(c.id)).filter(Boolean).map(i => i.url)
    expect(new Set(urls).size).toBe(urls.length)
    expect(got.size).toBeLessThan(cards.length)
  })
})
