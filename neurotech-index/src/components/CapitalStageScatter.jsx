import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  scatterPoints, filterFunding, STAGE_BANDS, STAGE_LABELS, MODALITY_LABELS, MODALITY_COLOR,
  DEFAULT_STATUS_FILTER, AGE_BANDS, ageBand, fmtUsd, fmtMonthYear,
} from '../lib/fundingBoard'
import { median, logDomain, logScale, decadeTicks, beeswarm, swarmSpread } from '../lib/swarm'

/**
 * Capital against clinical and regulatory maturity.
 *
 * The brief asked for one ordered axis from preclinical to commercial. That axis
 * mixes two different routes, and mixing them produces a trend that is not
 * there: see STAGE_BANDS in fundingBoard.js and
 * docs/funding-stage-scatter-finding.md. So the axis is banded, and the caption
 * reports what the data actually shows rather than the claim the chart was
 * commissioned to support.
 *
 * ── What changed on 15 Aug 2026, and why ────────────────────────────────────
 *
 * The figure was honest about its statistics and unreadable as a picture.
 * Measured on the live chart: 34 of 45 points sat inside the leftmost tenth of
 * the plot, the median company sat at 3.4% of the width, and 46 pairs of points
 * overlapped. A reader could not tell $5M from $50M, which is the comparison
 * the caption invites within a band.
 *
 * **The X axis is log.** docs/funding-stage-scatter-finding.md says not to
 * switch to one, and it is worth being explicit about why that does not apply:
 * the rule is aimed at a MOTIVE, rescuing a null result by making the cloud look
 * less structured. The number the caption reports is a Spearman correlation,
 * computed on ranks, and logScale is monotonic, so it cannot move that number by
 * any amount. `swarm.test.js` asserts the rank order survives. Nothing here is
 * fitted, smoothed, or re-measured; the axis is spaced so the points can be
 * seen. The prohibition on dropping cleared_510k still stands and is untouched.
 *
 * **Points are laid out by beeswarm rather than index jitter.** The old
 * `((i % 5) - 2) * 4.4` depended on a company's position in the array, not on
 * where its neighbours landed. See src/lib/swarm.js.
 *
 * **Each row carries its own count and median**, because those four medians are
 * the actual finding in the doc and the reader was being asked to eyeball them.
 * They are computed from the plotted set, so they cannot go stale the way a
 * number typed into a caption does.
 *
 * **Size no longer encodes recent capital.** It was a dead channel: 27 of 45
 * points sat at the floor radius because they had no round in the window, so
 * "size is capital raised in the last 24 months" was false for most of the
 * chart, and the floor made "no round at all" identical to "a rounding error".
 * The scale was also not what its own comment claimed — with the additive floor,
 * a company at a quarter of the maximum drew at 2.3x the area, not 4x. Recency
 * is now the binary it always was in the data: filled means a round in the
 * window, hollow means none.
 */

/**
 * ── Why the figure is shaped the way it is ─────────────────────────────────
 *
 * Everything in an SVG scales with its container, type included, so the only
 * thing that fixes a size is the ratio of that size to W. At 780 wide with
 * 9px gutter labels, a 640px viewport rendered them at 7.4px and drew the
 * points 5.9px across. The figure was also 3.5:1, which is a letterbox strip
 * rather than a plot.
 *
 * So: fewer units of width per unit of height, larger type as a share of W,
 * and a min-width on the element (below) that makes a narrow screen SCROLL
 * rather than shrink. That last one is the rule FundingChart already follows —
 * squeezing costs the marks the thing they are read for.
 */
const W = 800
const PAD = { l: 190, r: 34, t: 26, b: 58 }
/**
 * Point radius carries company age, in the three bands of AGE_BANDS.
 *
 * Size was a dead channel here once before, encoding trailing capital that 27 of
 * 45 companies did not have, and it is only back because age is banded rather
 * than continuous. When the encoding shipped, 38 of the 45 carried a band
 * against 29 that could have carried a continuous size; a web-search sweep has
 * since taken it to 40. Areas are roughly 1 : 2 : 3.5, which is readable at
 * three levels without the largest dot swamping its neighbours.
 *
 * Whatever is left unplaced is drawn at UNPLACED_R with a dotted outline and
 * counted in the legend — do not read a number here as current, since the sweep
 * moves it; the legend counts what is actually on screen. They are not defaulted
 * into the middle band: an unplaceable company is one whose sources do not say,
 * and saying so is the same discipline as the floor arrows on partial totals.
 *
 * A band survives evidence a continuous scale could not use. A Form D filing
 * from an issuer formed more than five years earlier gives no year at all, only
 * "over five years ago" — which is a LOWER bound on age, and lands unambiguously
 * in the top band while placing nowhere on a continuous axis.
 */
const AGE_R = { young: 3.4, mid: 4.7, old: 6.2 }
const UNPLACED_R = 3.0
/** Collision spacing for the swarm. One radius for every point, the largest, so
 *  no pair can overlap whatever mix of sizes a row happens to hold. */
const R = 6.2
const BAND_GAP = 42
const MIN_ROW = 48
const ROW_PAD = 18        // breathing room around a swarm inside its row

/**
 * Every row names its largest raise, in a strip of headroom reserved above the
 * swarm. Without it the figure could not be read at all without a pointer: 45
 * identical circles, and the only way to learn which one is Neuralink was to
 * hover it. One name per row is the most the space carries before the labels
 * start colliding with each other, and the largest is the one a reader is most
 * likely to be looking for.
 *
 * The label carries the amount as well as the name, because reading a value off
 * a log axis by eye is guesswork between the decades.
 */
const LABEL_H = 16        // headroom above each swarm, for that row's label
const LABEL_FONT = 8.5
/** Inter has no metrics available here, so the width of a label is estimated to
 *  keep it inside the plot. 0.5em per character runs slightly wide on this
 *  string mix, which is the safe direction to be wrong in: the cost is a label
 *  clamped a little early, not one running off the axis. */
const labelWidth = s => s.length * LABEL_FONT * 0.5

/**
 * A median is a summary, and drawing one over three companies lends it the same
 * authority as one drawn over twenty-six. The rows here run from 3 to 26, so
 * below this count the row states its n and no median is drawn: the reader is
 * told what is there rather than handed a centre line to read a trend off.
 */
const MIN_MEDIAN_N = 5

const GRID = '#E4E2DC'
const INK = '#16181D'
/** Alternate stage rows carry a faint lane, because the thing a reader must not
 *  get wrong is which stage a point belongs to, and a swarm that bulges puts
 *  points close to the row above it. */
const LANE = '#EDEBE4'
/** LANE at 50% over FIG_BG, precomputed. A hollow point is filled with whatever
 *  its own lane is, so it reads as a hole in both, and so the gridline behind it
 *  does not run through the middle of the ring. */
const LANE_BG = '#F4F3EF'
/** Module-level so an uncontrolled figure gets the same object every render and
 *  the layout memo is not rebuilt on every parent update. */
const NO_FILTERS = { statuses: DEFAULT_STATUS_FILTER, modalities: [], stageMin: null }
/** The figure's own background: canvas at 50% over paper. A hollow point is
 *  filled with it so it reads as empty rather than as a white dot. */
const FIG_BG = '#FBFBF9'

export default function CapitalStageScatter({ board, filters = null }) {
  const [asTable, setAsTable] = useState(false)
  const navigate = useNavigate()

  // The whole plottable set, before the page's filters. Decides whether there
  // is a figure at all, so a narrow filter cannot make the section vanish.
  const all = useMemo(() => (board ? scatterPoints(board.rows) : []), [board])

  /**
   * The filters come from the controls above this figure. Left out, the default
   * still excludes acquired and defunct companies, which is what the chart
   * beside it does: this figure used to plot companies its neighbour had
   * deliberately hidden, with no way to tell.
   */
  const active = filters || NO_FILTERS
  const points = useMemo(
    () => (board ? scatterPoints(filterFunding(board.rows, active)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, active.statuses, active.modalities, active.stageMin],
  )

  const layout = useMemo(() => {
    const domain = logDomain(points.map(p => p.total))
    const x = logScale(domain, PAD.l, W - PAD.r)

    // Only stages that actually hold a company get a row. An empty row would
    // imply we looked and found nobody, when mostly the stage is one this
    // pipeline never derives.
    const rows = []
    for (const band of STAGE_BANDS) {
      const stages = band.stages
        .filter(s => points.some(p => p.furthestStage === s))
        .map(s => {
          const members = points.filter(p => p.furthestStage === s)
          const placed = beeswarm(members.map(p => ({ x: x(p.total), key: p.id, p })), R)
          const swarmH = Math.max(MIN_ROW, 2 * (swarmSpread(placed) + R) + ROW_PAD)
          return {
            stage: s,
            placed,
            n: members.length,
            top: members.reduce((a, b) => (b.total > a.total ? b : a)),
            // Held back below MIN_MEDIAN_N. The row still states its count, so
            // the reader sees a stage with three companies in it rather than a
            // stage whose summary happens to be missing.
            median: members.length >= MIN_MEDIAN_N ? median(members.map(p => p.total)) : null,
            swarmH,
            height: swarmH + LABEL_H,
          }
        })
      if (stages.length) rows.push({ band, stages })
    }

    let y = PAD.t
    let lane = 0     // counts across bands, so two adjacent rows always differ
    for (const [i, group] of rows.entries()) {
      if (i > 0) y += BAND_GAP
      group.y0 = y
      for (const row of group.stages) {
        row.y0 = y
        // The swarm is centred in what is left of the row AFTER the label strip,
        // so a label never sits on top of a point.
        row.cy = y + LABEL_H + row.swarmH / 2
        row.lane = lane++
        y += row.height
      }
      group.y1 = y
    }
    return { rows, x, domain, height: y + PAD.b }
  }, [points])

  // Not enough evidence-backed companies for a scatter to mean anything. This
  // reads the unfiltered set, so it is a statement about the data and not about
  // what the reader has narrowed to.
  if (!board || all.length < 5) return null

  const H = layout.height
  /** Ages are whole years, so the reader's calendar year is precise enough and
   *  the figure does not need to know today's date. */
  const year = new Date().getFullYear()
  const modalities = [...new Set(points.map(p => p.modality).filter(Boolean))]
  const recent = points.filter(p => p.trailing > 0).length
  const partial = points.filter(p => p.partialTotal).length
  const byAge = points.reduce((acc, p) => {
    const b = ageBand(p, year)
    acc[b || 'none'] = (acc[b || 'none'] || 0) + 1
    return acc
  }, {})
  const anyAge = AGE_BANDS.some(b => byAge[b.id])
  const narrowed = all.length - points.length
  const go = r => navigate(r.href)

  return (
    <figure className="border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 mb-10">
      <figcaption className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Investment</p>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">
            Capital raised against verified stage
          </h2>
          {/* With filters on, the count is stated as a fraction of the whole
              plottable set. "N companies" alone reads as the population when it
              is a slice of one, and "0 companies" with nothing beside it reads
              as no data rather than as a filter the reader can widen. */}
          <p className="text-[13px] text-muted font-sans mt-1">
            {narrowed > 0
              ? <>{points.length} of {all.length} companies whose stage is traceable to a trial
                  record or an FDA decision, after the filters above.</>
              : <>{points.length} {points.length === 1 ? 'company' : 'companies'} whose stage is
                  traceable to a trial record or an FDA decision.</>}
          </p>
        </div>
        <button onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          className="text-[11px] font-sans text-muted underline decoration-rule underline-offset-2 hover:text-ink">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </figcaption>

      {points.length < 3 ? (
        <p className="py-6 text-[13px] font-sans text-muted border-t border-rule">
          Too few companies match these filters to plot. Widen them above.
        </p>
      ) : (
        <>
          {/* ── Legend ──────────────────────────────────────────────────────
              Two rows. Modality is what the colour means; the second row is
              what every other mark on the plot means, since three of them
              (hollow, median rule, floor arrow) carry information no colour
              does. */}
          <div className="mb-2 pb-1 flex flex-nowrap items-center gap-x-3 overflow-x-auto text-[11px] font-sans">
            <span className="shrink-0 uppercase tracking-[0.08em] text-muted/70">Modality</span>
            {modalities.map(m => (
              <span key={m} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
                <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: MODALITY_COLOR[m] }} />
                {MODALITY_LABELS[m]}
              </span>
            ))}
          </div>

          <div className="mb-3 pb-1 flex flex-nowrap items-center gap-x-3 overflow-x-auto text-[11px] font-sans">
            <span className="shrink-0 uppercase tracking-[0.08em] text-muted/70">Marks</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
              <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                <circle cx="6" cy="6" r="4.2" fill={INK} fillOpacity="0.78" />
              </svg>
              Raised in the last 24 months ({recent})
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
              <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                <circle cx="6" cy="6" r="4.2" fill={FIG_BG} stroke={INK} strokeWidth="1.8" />
              </svg>
              No round in that window ({points.length - recent})
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
              <svg aria-hidden width="7" height="11" viewBox="0 0 7 11" className="shrink-0">
                <line x1="3.5" x2="3.5" y1="1" y2="10" stroke={INK} strokeOpacity="0.62" strokeWidth="1.6" />
              </svg>
              Median, where the stage holds {MIN_MEDIAN_N} or more
            </span>
            {partial > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
                <svg aria-hidden width="15" height="12" viewBox="0 0 15 12" className="shrink-0">
                  <circle cx="4.5" cy="6" r="4.2" fill={INK} fillOpacity="0.78" />
                  <path d="M10.5 6 h4 m-2.6 -2.4 l2.6 2.4 l-2.6 2.4" fill="none"
                    stroke={INK} strokeOpacity="0.65" strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Private total only, so the point is a floor ({partial})
              </span>
            )}
          </div>

          {anyAge && (
            <div className="mb-3 pb-1 flex flex-nowrap items-center gap-x-3 overflow-x-auto text-[11px] font-sans">
              <span className="shrink-0 uppercase tracking-[0.08em] text-muted/70">Age</span>
              {AGE_BANDS.filter(b => byAge[b.id]).map(b => (
                <span key={b.id} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
                  <svg aria-hidden width="15" height="15" viewBox="0 0 15 15" className="shrink-0">
                    <circle cx="7.5" cy="7.5" r={AGE_R[b.id]} fill={INK} fillOpacity="0.78" />
                  </svg>
                  {b.label} ({byAge[b.id]})
                </span>
              ))}
              {byAge.none > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
                  <svg aria-hidden width="15" height="15" viewBox="0 0 15 15" className="shrink-0">
                    <circle cx="7.5" cy="7.5" r={UNPLACED_R} fill={FIG_BG} stroke={INK}
                      strokeWidth="1.4" strokeDasharray="1.6 1.4" />
                  </svg>
                  Age not established ({byAge.none})
                </span>
              )}
            </div>
          )}

          {asTable ? <ScatterTable points={points} /> : (
            // The scale is bracketed at BOTH ends, because everything in an SVG
            // scales with its container and there is no font size that is right
            // at 640px and at 1500px. Below the floor the figure scrolls, the
            // rule FundingChart already follows and at the same 820px. Above the
            // ceiling it stops growing and centres, because a card 1380px wide
            // was drawing 22px stage labels next to 13px body text and turning
            // the plot back into a ribbon. Between the two, type varies by a
            // fifth across every viewport the site sees.
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${W} ${H}`} role="img"
                className="block mx-auto w-full h-auto min-w-[820px] max-w-[1120px]"
                aria-label={`Capital raised against verified stage for ${points.length} companies, on a logarithmic axis, banded into clinical evidence and FDA authorisation.`}>
                {/* ── Lanes ───────────────────────────────────────────────
                    Drawn first, under everything. Each stage gets a band the
                    full width of the figure, label included, so a point that
                    bulges out of a crowded swarm still reads as belonging to
                    the row its label is in. */}
                {layout.rows.flatMap(g => g.stages).filter(r => r.lane % 2 === 0).map(row => (
                  <rect key={`lane-${row.stage}`} x="0" y={row.y0} width={W - PAD.r} height={row.height}
                    fill={LANE} fillOpacity="0.5" />
                ))}

                {/* ── X axis: one gridline per decade ─────────────────────── */}
                {decadeTicks(layout.domain).map(v => (
                  <g key={v}>
                    <line x1={layout.x(v)} x2={layout.x(v)} y1={PAD.t} y2={H - PAD.b}
                      stroke={GRID} strokeWidth="1" />
                    <text x={layout.x(v)} y={H - PAD.b + 20} textAnchor="middle"
                      className="fill-muted" style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
                      {fmtUsd(v)}
                    </text>
                  </g>
                ))}
                <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - PAD.b + 42} textAnchor="middle"
                  className="fill-muted" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                  TOTAL PRIVATE CAPITAL RAISED · EACH GRIDLINE IS TEN TIMES THE LAST
                </text>

                {layout.rows.map(group => (
                  <g key={group.band.id}>
                    <text x={4} y={group.y0 - 9} className="fill-muted/70"
                      style={{ fontSize: 9.5, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                      {group.band.label}
                    </text>
                    <line x1={0} x2={W - PAD.r} y1={group.y0 - 1} y2={group.y0 - 1}
                      stroke={GRID} strokeWidth="1.5" />

                    {group.stages.map(row => (
                      <g key={row.stage}>
                        {/* The stage, then what its row holds. The medians are
                            the finding; printing them beats asking a reader to
                            estimate a centre from a cloud of 26 dots. */}
                        <text x={PAD.l - 18} y={row.cy - 3} textAnchor="end"
                          className="fill-ink-soft" style={{ fontSize: 11.5 }}>
                          {STAGE_LABELS[row.stage]}
                        </text>
                        <text x={PAD.l - 18} y={row.cy + 12} textAnchor="end"
                          className="fill-muted/80"
                          style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}>
                          {row.n} {row.n === 1 ? 'company' : 'companies'}
                          {row.median != null && ` · median ${fmtUsd(row.median)}`}
                        </text>

                        {/* Behind the points, so it never hides one. Darker and
                            thicker than a gridline, or at this size it reads as
                            a piece of one. Absent below MIN_MEDIAN_N. */}
                        {row.median != null && (
                          <line x1={layout.x(row.median)} x2={layout.x(row.median)}
                            y1={row.cy - row.swarmH / 2 + 4} y2={row.cy + row.swarmH / 2 - 4}
                            stroke={INK} strokeOpacity="0.62" strokeWidth="1.6" />
                        )}

                        {/* The row's largest raise, named. aria-hidden: the
                            point itself already carries the name and the amount
                            in its accessible label, and a second copy would be
                            read out twice. */}
                        {(() => {
                          const mark = row.placed.find(q => q.p.id === row.top.id)
                          if (!mark) return null
                          const text = `${row.top.name} · ${fmtUsd(row.top.total)}`
                          const half = labelWidth(text) / 2
                          // Kept inside the plot. Where that pulls the label off
                          // its point, a hairline says which point it belongs to.
                          const lx = Math.min(Math.max(mark.x, PAD.l + half), W - PAD.r - half)
                          const ly = row.y0 + LABEL_H - 5
                          return (
                            <g aria-hidden>
                              <line x1={lx} y1={ly + 2.5} x2={mark.x} y2={row.cy + mark.y - R - 1.5}
                                stroke={INK} strokeOpacity="0.3" strokeWidth="0.8" />
                              <text x={lx} y={ly} textAnchor="middle" className="fill-muted"
                                style={{ fontSize: LABEL_FONT }}>
                                {text}
                              </text>
                            </g>
                          )
                        })()}

                        {row.placed.map(({ p, x: cx, y: dy }) => {
                          const cy = row.cy + dy
                          const color = MODALITY_COLOR[p.modality] || '#6B7280'
                          const isRecent = p.trailing > 0
                          const band = ageBand(p, year)
                          const pr = band ? AGE_R[band] : UNPLACED_R
                          const age = p.incorporatedYear
                            ? ` Incorporated ${p.incorporatedYear}.`
                            : p.incorporatedBefore
                              ? ` Incorporated no later than ${p.incorporatedBefore}.`
                              : ' Incorporation year not established.'
                          const label = `${p.name}. ${fmtUsd(p.total)} raised`
                            + (p.partialTotal ? ', private capital only, so the figure is a floor. ' : '. ')
                            + `${STAGE_LABELS[p.furthestStage]}.`
                            + (p.modality ? ` ${MODALITY_LABELS[p.modality]}.` : '')
                            + (isRecent ? ` ${fmtUsd(p.trailing)} in the last 24 months.`
                              : ' No round in the last 24 months.')
                            + age
                          return (
                            <g key={p.id} role="link" tabIndex={0} aria-label={label}
                              onClick={() => go(p)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(p) } }}
                              className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-ink">
                              <title>{label}</title>
                              <circle cx={cx} cy={cy} r={pr}
                                fill={isRecent ? color : (row.lane % 2 === 0 ? LANE_BG : FIG_BG)}
                                fillOpacity={isRecent ? 0.78 : 1}
                                stroke={isRecent ? '#FFFFFF' : color}
                                strokeWidth={isRecent ? 1.1 : 1.8}
                                strokeDasharray={band ? undefined : '1.6 1.4'} />
                              {/* A private-only total on a company that also
                                  raised publicly is a lower bound, so the point
                                  says which way the truth lies. */}
                              {p.partialTotal && (
                                <path d={`M${cx + pr + 2} ${cy} h7.5 m-3 -2.8 l3 2.8 l-3 2.8`}
                                  fill="none" stroke={color} strokeOpacity="0.8" strokeWidth="1.3"
                                  strokeLinecap="round" strokeLinejoin="round" />
                              )}
                            </g>
                          )
                        })}
                      </g>
                    ))}
                  </g>
                ))}
              </svg>
            </div>
          )}
        </>
      )}

      <div className="mt-4 pt-3 border-t border-rule text-[11.5px] font-sans text-muted leading-relaxed space-y-1.5">
        <p>
          The two bands are different regulatory routes, not steps in one sequence. A cleared 510(k)
          device is not a later stage of a pivotal trial, so positions are comparable within a band
          and not across the divide.
        </p>
        <p>
          Capital is drawn on a logarithmic axis because the set spans from under $1M to $1.2B, and
          on a linear one 34 of the 45 companies fell inside the leftmost tenth of the plot. The
          correlation below is a rank correlation, so the spacing of the axis does not enter it.
        </p>
        <p>
          Within the clinical band the two are weakly and positively related, and the sample is too
          small to call it: Spearman rho 0.35 across 19 companies, with a confidence interval that
          crosses zero. In the authorisation band every company sits at 510(k) cleared, so there is
          no spread to read a trend from. Measured 29 July 2026 over the unfiltered set.
        </p>
        <p>
          Point size is the company&apos;s age, from the year of incorporation it declared on its own
          Form D filing. That is not the same fact as when it was founded: a company can trade for
          years before incorporating, and redomiciling into the US resets the declared year while the
          company is unchanged. An issuer formed more than five years before filing declares no year
          at all, only that it was earlier, which places it in the oldest band when the bound allows
          and nowhere when it does not.
        </p>
        <p>
          Stage comes from a ClinicalTrials.gov record or an FDA decision. Companies whose stage
          could not be established are not plotted, so absence here is missing evidence rather than
          early stage.
        </p>
      </div>
    </figure>
  )
}

function ScatterTable({ points }) {
  const rows = [...points].sort((a, b) => b.total - a.total)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12px] font-sans border-collapse">
        <caption className="sr-only">Companies by capital raised, verified stage, modality and recent capital.</caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-muted/70 text-left border-b border-rule">
            <th scope="col" className="py-1.5 pr-2 font-semibold">Company</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Band</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Stage</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Modality</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold text-right">Total</th>
            <th scope="col" className="py-1.5 font-semibold text-right">Last 24 months</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} className="border-b border-rule-soft">
              <th scope="row" className="py-1.5 pr-2 font-normal text-left">
                <Link to={p.href} className="text-ink-soft hover:text-accent">{p.name}</Link>
              </th>
              <td className="py-1.5 pr-2 text-muted">
                {STAGE_BANDS.find(b => b.id === p.band)?.label}
              </td>
              <td className="py-1.5 pr-2 text-muted">
                {p.stageEvidenceUrl
                  ? <a href={p.stageEvidenceUrl} target="_blank" rel="noreferrer"
                      className="text-accent hover:underline">{STAGE_LABELS[p.furthestStage]}</a>
                  : STAGE_LABELS[p.furthestStage]}
              </td>
              <td className="py-1.5 pr-2 text-muted">{MODALITY_LABELS[p.modality] || 'Not available'}</td>
              <td className="py-1.5 pr-2 font-mono tabular-nums text-right text-ink">
                {fmtUsd(p.total)}
                {p.partialTotal && <sup className="text-muted" title="Private capital only">†</sup>}
              </td>
              <td className="py-1.5 font-mono tabular-nums text-right text-muted">
                {p.trailing ? fmtUsd(p.trailing) : '—'}
                {p.latestDate && <span className="hidden sm:inline"> · {fmtMonthYear(p.latestDate)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
