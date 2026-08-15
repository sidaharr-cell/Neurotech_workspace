/**
 * swarm.js — the plot geometry behind the capital-versus-stage scatter.
 *
 * Pure and tested, for the same reason src/lib/crop.js is: the claims the chart
 * makes about itself are geometric ones, and a claim in a comment that nothing
 * checks is a claim that quietly stops being true.
 *
 * Two claims live here.
 *
 * 1. **The swarm places no point on top of another.** The chart used to spread
 *    points with `((i % 5) - 2) * 4.4`, an index jitter of five fixed offsets
 *    inside a 40px row. Measured 15 Aug 2026 on the live figure: 46 overlapping
 *    pairs across 45 points, because the offset depends on a company's position
 *    in the array and not on where its neighbours actually landed. `beeswarm`
 *    reads the neighbours.
 *
 * 2. **A log axis cannot move the number the caption reports.** The caption
 *    reports a Spearman correlation, which is computed on ranks, and every
 *    function here is monotonic in its input, so it reorders nothing. That is
 *    the difference between decompressing an axis and adjusting a chart to
 *    produce a claim, which docs/funding-stage-scatter-finding.md forbids.
 */

/** Ordinary median. Even-length sets take the mean of the middle two. */
export function median(values) {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The domain to plot a set of positive amounts on.
 *
 * Snaps the low end DOWN to a whole power of ten so the first gridline is a
 * round number a reader recognises, and pads the high end so the largest point
 * is not drawn half off the axis. Values at or below zero have no position on a
 * log axis and are the caller's problem; `logScale` clamps rather than
 * returning NaN, so one bad row cannot blank the figure.
 */
export function logDomain(values, pad = 1.2) {
  const positive = values.filter(v => v > 0)
  if (!positive.length) return [1, 10]
  const lo = 10 ** Math.floor(Math.log10(Math.min(...positive)))
  const hi = Math.max(...positive) * pad
  return [lo, hi <= lo ? lo * 10 : hi]
}

/** Amount to pixel, log-spaced. Monotonic, so it preserves every rank. */
export function logScale([lo, hi], x0, x1) {
  const a = Math.log10(lo)
  const span = Math.log10(hi) - a
  return v => x0 + ((Math.log10(Math.min(Math.max(v, lo), hi)) - a) / span) * (x1 - x0)
}

/**
 * Every whole power of ten inside the domain.
 *
 * Decades only: on a four-decade axis 600px wide, minor ticks at 2, 5, 20, 50
 * put eighteen labels where five will do, and the reader is being asked to
 * read the shape of a cloud rather than the value of a point.
 */
export function decadeTicks([lo, hi]) {
  const out = []
  for (let e = Math.round(Math.log10(lo)); 10 ** e <= hi; e++) out.push(10 ** e)
  return out
}

/**
 * Lay a row of points out so none of them overlap.
 *
 * Each point takes the vertical offset CLOSEST TO ZERO that clears everything
 * already placed, which keeps the row centred on its stage line and lets a
 * dense patch bulge outward rather than pile up. Points are placed in x order,
 * so the result depends only on the data: no randomness, no dependence on the
 * order rows arrived from the database. The chart renders identically every
 * time, which is the one property the index jitter it replaces did have.
 *
 * `items` are `{ x, key, ...rest }`; the return adds `y`, an offset from the
 * row's centre line. `key` breaks ties between points at the same x, and must
 * be unique and stable.
 */
export function beeswarm(items, radius, minGap = 0.6) {
  const gap = 2 * radius + minGap
  const placed = []
  const ordered = [...items].sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  for (const item of ordered) {
    // Only points within one diameter horizontally can possibly collide.
    const near = placed.filter(q => Math.abs(q.x - item.x) < gap)
    let y = 0
    if (near.length) {
      // The candidate offsets are zero and, for each neighbour, the two heights
      // at which this point just touches it. One of them is always free: the
      // topmost and bottommost candidates lie clear of every neighbour.
      const candidates = [0]
      for (const q of near) {
        const dy = Math.sqrt(Math.max(gap * gap - (q.x - item.x) ** 2, 0))
        candidates.push(q.y + dy, q.y - dy)
      }
      const clear = v => near.every(q => Math.hypot(q.x - item.x, q.y - v) >= gap - 1e-9)
      const free = candidates.filter(clear).sort((a, b) => Math.abs(a) - Math.abs(b))
      y = free.length ? free[0] : 0
    }
    placed.push({ ...item, y })
  }
  return placed
}

/** How far the swarm reaches from its centre line, which is what decides how
 *  tall the row has to be drawn. */
export const swarmSpread = placed =>
  placed.reduce((m, p) => Math.max(m, Math.abs(p.y)), 0)
