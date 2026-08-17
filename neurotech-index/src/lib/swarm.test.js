import { describe, it, expect } from 'vitest'
import { median, logDomain, logScale, decadeTicks, beeswarm, swarmSpread } from './swarm'

/** The property the whole layout exists to hold: no two points overlap. */
const overlaps = (placed, radius) => {
  let n = 0
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const d = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y)
      if (d < 2 * radius - 1e-6) n++
    }
  }
  return n
}

const swarmOf = (xs, r = 3.6) =>
  beeswarm(xs.map((x, i) => ({ x, key: `k${i}` })), r)

describe('median', () => {
  it('takes the middle of an odd set', () => {
    expect(median([5, 1, 3])).toBe(3)
  })
  it('takes the mean of the middle two of an even set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('does not disturb the caller\'s array', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })
  it('has no answer for an empty set', () => {
    expect(median([])).toBe(null)
  })
})

describe('the log domain', () => {
  it('snaps the low end down to a whole power of ten', () => {
    // The real set on 15 Aug 2026: $393K to $1.2B.
    expect(logDomain([393e3, 1.2e9])[0]).toBe(1e5)
  })

  it('leaves room to the right of the largest point', () => {
    const [, hi] = logDomain([393e3, 1.2e9])
    expect(hi).toBeGreaterThan(1.2e9)
  })

  it('ignores amounts that have no position on a log axis', () => {
    expect(logDomain([0, -5, 2e6, 4e6])[0]).toBe(1e6)
  })

  it('gives a usable domain when every amount is the same', () => {
    const [lo, hi] = logDomain([5e6, 5e6])
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('the log scale', () => {
  const d = logDomain([393e3, 1.2e9])
  const x = logScale(d, 100, 700)

  it('puts the ends of the domain at the ends of the axis', () => {
    expect(x(d[0])).toBeCloseTo(100)
    expect(x(d[1])).toBeCloseTo(700)
  })

  it('gives every decade the same width', () => {
    const a = x(1e6) - x(1e5)
    const b = x(1e9) - x(1e8)
    expect(a).toBeCloseTo(b, 6)
  })

  /**
   * The reason the axis was allowed to change at all. The caption reports a
   * Spearman correlation, which is computed on ranks; if the scale preserved
   * every rank then it cannot have moved that number, and switching to it is
   * not "adjusting the chart to produce the claim".
   */
  it('preserves the rank of every company', () => {
    const totals = [393e3, 2e6, 19.5e6, 70.5e6, 259e6, 425e6, 1.2e9]
    const scaled = totals.map(x)
    const sorted = [...scaled].sort((a, b) => a - b)
    expect(scaled).toEqual(sorted)
  })

  it('clamps rather than returning NaN for an amount off the axis', () => {
    expect(Number.isFinite(x(0))).toBe(true)
    expect(x(0)).toBe(100)
  })
})

describe('decade ticks', () => {
  it('gives one round gridline per decade covered', () => {
    expect(decadeTicks(logDomain([393e3, 1.2e9]))).toEqual([1e5, 1e6, 1e7, 1e8, 1e9])
  })

  it('stops inside the domain', () => {
    const d = logDomain([2e6, 4e6])
    expect(decadeTicks(d).every(t => t <= d[1])).toBe(true)
  })
})

describe('the beeswarm', () => {
  it('leaves a lone point on the centre line', () => {
    expect(swarmOf([300])[0].y).toBe(0)
  })

  it('leaves well-separated points on the centre line', () => {
    expect(swarmOf([100, 200, 300]).every(p => p.y === 0)).toBe(true)
  })

  it('separates points that would otherwise sit on top of one another', () => {
    const placed = swarmOf([200, 200, 200, 200])
    expect(overlaps(placed, 3.6)).toBe(0)
  })

  /**
   * The case the chart actually has: 26 companies in the 510(k) cleared row,
   * most of them between $2M and $100M, which on the log axis is about 250px.
   * The index jitter it replaces produced 46 overlapping pairs across the
   * figure's 45 points.
   */
  it('overlaps nothing in a dense row', () => {
    const xs = Array.from({ length: 26 }, (_, i) => 300 + (i % 9) * 5)
    const placed = swarmOf(xs)
    expect(placed).toHaveLength(26)
    expect(overlaps(placed, 3.6)).toBe(0)
  })

  it('overlaps nothing when every point is at the same x', () => {
    expect(overlaps(swarmOf(Array(20).fill(400)), 3.6)).toBe(0)
  })

  it('stays centred, spreading both ways rather than piling upward', () => {
    const placed = swarmOf(Array(9).fill(400))
    expect(placed.some(p => p.y > 0)).toBe(true)
    expect(placed.some(p => p.y < 0)).toBe(true)
  })

  it('keeps the row as shallow as the data allows', () => {
    // Nine points at one x stack at whole multiples of the gap: the centre line
    // and four to a side. Anything deeper is space the row is taking for
    // nothing, and rows are what the figure's height is made of.
    const gap = 2 * 3.6 + 0.6
    expect(swarmSpread(swarmOf(Array(9).fill(400)))).toBeCloseTo(4 * gap, 6)
  })

  /** Rendering identically every time is the one property the index jitter had,
   *  and losing it would make every deploy a visual diff. */
  it('does not depend on the order the rows arrived in', () => {
    const items = [
      { x: 400, key: 'c' }, { x: 402, key: 'a' },
      { x: 400, key: 'b' }, { x: 399, key: 'd' },
    ]
    const forward = beeswarm(items, 3.6)
    const backward = beeswarm([...items].reverse(), 3.6)
    const byKey = p => [p.key, p.y]
    expect(forward.map(byKey)).toEqual(backward.map(byKey))
  })

  it('places nothing for an empty row', () => {
    expect(beeswarm([], 3.6)).toEqual([])
  })
})
