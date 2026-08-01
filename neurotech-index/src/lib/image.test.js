import { describe, it, expect } from 'vitest'
import { imageOf, usableImage, isIllustration, creditLine, needsCredit, duplicateImageIds } from './image'

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

  it('always asks for one on an illustration, licence or not', () => {
    expect(needsCredit(imageOf(feedRow({ imageSubject: 'class' })))).toBe(true)
  })
})

describe('duplicateImageIds', () => {
  const withUrl = (id, url) => ({ id, metadata: { image: url, imageSubject: 'class' } })

  it('keeps the first card and marks the repeats', () => {
    const dupes = duplicateImageIds([withUrl('a', 'x.jpg'), withUrl('b', 'x.jpg'), withUrl('c', 'y.jpg'), withUrl('d', 'x.jpg')])
    expect([...dupes].sort()).toEqual(['b', 'd'])
  })

  it('ignores records with no picture', () => {
    expect(duplicateImageIds([{ id: 'a', metadata: {} }, null, { id: 'b' }]).size).toBe(0)
  })
})
