import { describe, it, expect } from 'vitest'
import { positionFor, keptFraction, focusFor } from './crop'

/**
 * The crop window for `object-fit: cover` at `object-position: p`.
 * Everything below asserts against this rather than against a magic number,
 * because it is the browser's rule and the point is that the subject lands
 * inside it.
 */
const window_ = (p, frac) => [p * (1 - frac), p * (1 - frac) + frac]
const holds = (p, frac, a, b) => {
  const [s, e] = window_(p, frac)
  return s <= a + 1e-9 && e >= b - 1e-9
}

describe('how much of a picture a cover-crop keeps', () => {
  it('keeps everything when the picture is already the frame shape', () => {
    expect(keptFraction(1200, 900, 4 / 3).x).toBeCloseTo(1)
    expect(keptFraction(1200, 900, 4 / 3).y).toBeCloseTo(1)
  })

  it('loses width from a picture wider than the frame', () => {
    const f = keptFraction(2451, 1067, 4 / 3)   // a real panorama on the site
    expect(f.y).toBe(1)
    expect(f.x).toBeCloseTo(0.58, 2)
  })

  it('loses height from a picture taller than the frame', () => {
    const f = keptFraction(1200, 1600, 4 / 3)   // the common 3:4 portrait
    expect(f.x).toBe(1)
    expect(f.y).toBeCloseTo(0.5625, 3)
  })
})

describe('a subject that fits the window is held inside it', () => {
  it('holds a subject sitting off to one side', () => {
    const frac = 0.48                       // a 2.77:1 panorama in a 4:3 card
    const p = positionFor(0.55, 0.9, frac)  // subject on the right
    expect(holds(p, frac, 0.55, 0.9)).toBe(true)
  })

  it('holds a subject against the left edge', () => {
    const frac = 0.5
    const p = positionFor(0, 0.3, frac)
    expect(holds(p, frac, 0, 0.3)).toBe(true)
    expect(p).toBeGreaterThanOrEqual(0)
  })

  it('holds a subject against the right edge', () => {
    const frac = 0.5
    const p = positionFor(0.7, 1, frac)
    expect(holds(p, frac, 0.7, 1)).toBe(true)
    expect(p).toBeLessThanOrEqual(1)
  })

  it('holds the head and torso of a portrait cropped to a landscape card', () => {
    const frac = keptFraction(1200, 1600, 4 / 3).y   // 0.5625
    const p = positionFor(0.05, 0.45, frac)          // head and shoulders, upper frame
    expect(holds(p, frac, 0.05, 0.45)).toBe(true)
  })

  it('never returns a position outside the frame', () => {
    for (const [a, b, frac] of [[0, 0.1, 0.3], [0.9, 1, 0.3], [0.4, 0.6, 0.9], [0, 1, 0.2]]) {
      const p = positionFor(a, b, frac)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })
})

describe('a subject too big for the window loses its edges evenly', () => {
  it('centres the window on a subject that cannot fit', () => {
    const frac = 0.4
    const p = positionFor(0.1, 0.9, frac)     // subject spans 80%, window holds 40%
    const [s, e] = window_(p, frac)
    expect((s + e) / 2).toBeCloseTo(0.5, 2)   // centred on the subject's middle
  })

  it('still stays in range when the subject fills the picture', () => {
    const p = positionFor(0, 1, 0.5)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

describe('the centre is only the answer when nothing overflows', () => {
  it('returns the middle when the picture already fits', () => {
    expect(positionFor(0.2, 0.4, 1)).toBe(0.5)
  })

  it('is why a centre point alone was not enough', () => {
    // A real case: a 2.77:1 panorama keeps 48% of its width. A subject from
    // 55% to 90% has its centre at 72.5%, and the OLD rule stored that centre
    // directly. Placing the window at 72.5% cuts the subject; the extent-aware
    // answer holds all of it.
    const frac = 0.48
    expect(holds(0.725, frac, 0.55, 0.9)).toBe(false)
    expect(holds(positionFor(0.55, 0.9, frac), frac, 0.55, 0.9)).toBe(true)
  })
})

describe('focusFor picks the axis that actually crops', () => {
  it('moves a wide picture horizontally and leaves its height alone', () => {
    const f = focusFor({ left: 0.6, top: 0, right: 0.95, bottom: 1 }, 2451, 1067, 4 / 3)
    expect(f.y).toBe(50)
    expect(f.x).toBeGreaterThan(50)
  })

  it('moves a tall picture vertically and leaves its width alone', () => {
    const f = focusFor({ left: 0, top: 0.05, right: 1, bottom: 0.4 }, 1200, 1600, 4 / 3)
    expect(f.x).toBe(50)
    expect(f.y).toBeLessThan(50)
  })
})
