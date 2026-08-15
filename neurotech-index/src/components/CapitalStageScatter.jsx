import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  scatterPoints, filterFunding, STAGE_BANDS, STAGE_LABELS, MODALITY_LABELS, MODALITY_COLOR,
  DEFAULT_STATUS_FILTER, fmtUsd, fmtMonthYear,
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

const W = 780
const PAD = { l: 150, r: 30, t: 20, b: 48 }
const R = 3.6             // every point is the same size; see the note above
const BAND_GAP = 30
const MIN_ROW = 30
const ROW_PAD = 10        // breathing room around a swarm inside its row

const GRID = '#E4E2DC'
const INK = '#16181D'
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
          return {
            stage: s,
            placed,
            n: members.length,
            median: median(members.map(p => p.total)),
            height: Math.max(MIN_ROW, 2 * (swarmSpread(placed) + R) + ROW_PAD),
          }
        })
      if (stages.length) rows.push({ band, stages })
    }

    let y = PAD.t
    for (const [i, group] of rows.entries()) {
      if (i > 0) y += BAND_GAP
      group.y0 = y
      for (const row of group.stages) { row.cy = y + row.height / 2; y += row.height }
      group.y1 = y
    }
    return { rows, x, domain, height: y + PAD.b }
  }, [points])

  // Not enough evidence-backed companies for a scatter to mean anything. This
  // reads the unfiltered set, so it is a statement about the data and not about
  // what the reader has narrowed to.
  if (!board || all.length < 5) return null

  const H = layout.height
  const modalities = [...new Set(points.map(p => p.modality).filter(Boolean))]
  const recent = points.filter(p => p.trailing > 0).length
  const partial = points.filter(p => p.partialTotal).length
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
              <svg aria-hidden width="11" height="11" viewBox="0 0 11 11" className="shrink-0">
                <circle cx="5.5" cy="5.5" r="3.6" fill={INK} fillOpacity="0.78" />
              </svg>
              Raised in the last 24 months ({recent})
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
              <svg aria-hidden width="11" height="11" viewBox="0 0 11 11" className="shrink-0">
                <circle cx="5.5" cy="5.5" r="3.6" fill={FIG_BG} stroke={INK} strokeWidth="1.4" />
              </svg>
              No round in that window ({points.length - recent})
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
              <svg aria-hidden width="7" height="11" viewBox="0 0 7 11" className="shrink-0">
                <line x1="3.5" x2="3.5" y1="1" y2="10" stroke={INK} strokeOpacity="0.62" strokeWidth="1.6" />
              </svg>
              Median for the stage
            </span>
            {partial > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
                <svg aria-hidden width="13" height="11" viewBox="0 0 13 11" className="shrink-0">
                  <circle cx="4" cy="5.5" r="3.6" fill={INK} fillOpacity="0.78" />
                  <path d="M9 5.5 h3 m-2.2 -2.2 l2.2 2.2 l-2.2 2.2" fill="none"
                    stroke={INK} strokeOpacity="0.6" strokeWidth="1.1"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Private total only, so the point is a floor ({partial})
              </span>
            )}
          </div>

          {asTable ? <ScatterTable points={points} /> : (
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto min-w-[640px]" role="img"
                aria-label={`Capital raised against verified stage for ${points.length} companies, on a logarithmic axis, banded into clinical evidence and FDA authorisation.`}>
                {/* ── X axis: one gridline per decade ─────────────────────── */}
                {decadeTicks(layout.domain).map(v => (
                  <g key={v}>
                    <line x1={layout.x(v)} x2={layout.x(v)} y1={PAD.t} y2={H - PAD.b}
                      stroke={GRID} strokeWidth="1" />
                    <text x={layout.x(v)} y={H - PAD.b + 16} textAnchor="middle"
                      className="fill-muted" style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
                      {fmtUsd(v)}
                    </text>
                  </g>
                ))}
                <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - PAD.b + 34} textAnchor="middle"
                  className="fill-muted" style={{ fontSize: 10.5, letterSpacing: '0.08em' }}>
                  TOTAL PRIVATE CAPITAL RAISED · EACH GRIDLINE IS TEN TIMES THE LAST
                </text>

                {layout.rows.map(group => (
                  <g key={group.band.id}>
                    <text x={4} y={group.y0 - 5} className="fill-muted/70"
                      style={{ fontSize: 9.5, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                      {group.band.label}
                    </text>
                    <line x1={PAD.l - 12} x2={W - PAD.r} y1={group.y0 - 1} y2={group.y0 - 1}
                      stroke={GRID} strokeWidth="1" />

                    {group.stages.map(row => (
                      <g key={row.stage}>
                        {/* The stage, then what its row holds. The medians are
                            the finding; printing them beats asking a reader to
                            estimate a centre from a cloud of 26 dots. */}
                        <text x={PAD.l - 14} y={row.cy - 1} textAnchor="end"
                          className="fill-ink-soft" style={{ fontSize: 11.5 }}>
                          {STAGE_LABELS[row.stage]}
                        </text>
                        <text x={PAD.l - 14} y={row.cy + 10} textAnchor="end"
                          className="fill-muted/80"
                          style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}>
                          {row.n} · median {fmtUsd(row.median)}
                        </text>

                        {/* Behind the points, so it never hides one. Darker and
                            thicker than a gridline, or at this size it reads as
                            a piece of one. */}
                        <line x1={layout.x(row.median)} x2={layout.x(row.median)}
                          y1={row.cy - row.height / 2 + 2.5} y2={row.cy + row.height / 2 - 2.5}
                          stroke={INK} strokeOpacity="0.62" strokeWidth="1.6" />

                        {row.placed.map(({ p, x: cx, y: dy }) => {
                          const cy = row.cy + dy
                          const color = MODALITY_COLOR[p.modality] || '#6B7280'
                          const isRecent = p.trailing > 0
                          const label = `${p.name}. ${fmtUsd(p.total)} raised`
                            + (p.partialTotal ? ', private capital only, so the figure is a floor. ' : '. ')
                            + `${STAGE_LABELS[p.furthestStage]}.`
                            + (p.modality ? ` ${MODALITY_LABELS[p.modality]}.` : '')
                            + (isRecent ? ` ${fmtUsd(p.trailing)} in the last 24 months.`
                              : ' No round in the last 24 months.')
                          return (
                            <g key={p.id} role="link" tabIndex={0} aria-label={label}
                              onClick={() => go(p)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(p) } }}
                              className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-ink">
                              <title>{label}</title>
                              <circle cx={cx} cy={cy} r={R}
                                fill={isRecent ? color : FIG_BG}
                                fillOpacity={isRecent ? 0.78 : 1}
                                stroke={isRecent ? '#FFFFFF' : color}
                                strokeWidth={isRecent ? 1 : 1.4} />
                              {/* A private-only total on a company that also
                                  raised publicly is a lower bound, so the point
                                  says which way the truth lies. */}
                              {p.partialTotal && (
                                <path d={`M${cx + R + 1.5} ${cy} h6 m-2.4 -2.2 l2.4 2.2 l-2.4 2.2`}
                                  fill="none" stroke={color} strokeOpacity="0.75" strokeWidth="1.1"
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
