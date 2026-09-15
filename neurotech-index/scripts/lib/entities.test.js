import { describe, it, expect } from 'vitest'
import { decodeEntities, stripTags } from './entities.js'

describe('decodeEntities', () => {
  it('decodes the hex escapes PubMed actually emits', () => {
    expect(decodeEntities('CellCelector&#x2122;')).toBe('CellCelector™')
    expect(decodeEntities('Kimera&#xae;')).toBe('Kimera®')
    expect(decodeEntities('in&#xa0;vitro')).toBe('in vitro')
    expect(decodeEntities('Schr&#xf6;dinger')).toBe('Schrödinger')
    expect(decodeEntities('&#x3bc;m and &#x3b2;-amyloid')).toBe('μm and β-amyloid')
  })

  it('decodes decimal escapes and named entities', () => {
    expect(decodeEntities('5&#215;10')).toBe('5×10')
    expect(decodeEntities('Brain &amp; Behavior')).toBe('Brain & Behavior')
    expect(decodeEntities('&lt;i&gt;')).toBe('<i>')
  })

  it('leaves unknown named entities alone rather than mangling them', () => {
    expect(decodeEntities('&hellip; &notarealentity;')).toBe('&hellip; &notarealentity;')
  })

  it('is a no-op on clean text and tolerates null', () => {
    expect(decodeEntities('Plain title')).toBe('Plain title')
    expect(decodeEntities(null)).toBe('')
    expect(decodeEntities(undefined)).toBe('')
  })
})

describe('stripTags', () => {
  it('strips tags, then decodes, so an encoded tag cannot reappear as a real one', () => {
    expect(stripTags('<i>Nature</i> &lt;script&gt;')).toBe('Nature <script>')
  })

  it('collapses whitespace introduced by decoding', () => {
    expect(stripTags('  spaced   out  ')).toBe('spaced out')
  })
})
