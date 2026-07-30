import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  scatterPoints, STAGE_BANDS, STAGE_LABELS, MODALITY_LABELS, MODALITY_COLOR,
  fmtUsd, fmtMonthYear,
} from '../lib/fundingBoard'

/**
 * Capital against clinical and regulatory maturity.
 *
 * The brief asked for one ordered axis from preclinical to commercial. That axis
 * mixes two different routes, and mixing them produces a trend that is not
 * there: see STAGE_BANDS in fundingBoard.js and
 * docs/funding-stage-scatter-finding.md. So the axis is banded, and the caption
 * reports what the data actually shows rather than the claim the chart was
 * commissioned to support.
 */

const PAD = { l: 138, r: 18, t: 14, b: 42 }
const ROW = 40            // vertical space per stage
const BAND_GAP = 26       // extra space between the two bands
const W = 780

/** Radius carries trailing 24-month capital. Area, not radius, scales with the
 *  figure, so a company that raised four times as much looks four times as big
 *  rather than sixteen. A company with no round in the window gets the floor. */
const rOf = (trailing, maxTrailing) => {
  if (!trailing || !maxTrailing) return 3.5
  return 3.5 + Math.sqrt(trailing / maxTrailing) * 7.5
}

const niceTicks = max => {
  const step = max > 1e9 ? 250e6 : max > 4e8 ? 100e6 : max > 1e8 ? 50e6 : 25e6
  const out = []
  for (let v = 0; v <= max; v += step) out.push(v)
  return out
}

export default function CapitalStageScatter({ board }) {
  const [asTable, setAsTable] = useState(false)
  const navigate = useNavigate()

  const points = useMemo(() => (board ? scatterPoints(board.rows) : []), [board])

  const layout = useMemo(() => {
    // Only stages that actually hold a company get a row. An empty row would
    // imply we looked and found nobody, when mostly the stage is one this
    // pipeline never derives.
    const rows = []
    for (const band of STAGE_BANDS) {
      const present = band.stages.filter(s => points.some(p => p.furthestStage === s))
      if (present.length) rows.push({ band, stages: present })
    }
    let y = PAD.t
    const yOf = {}
    for (const [i, group] of rows.entries()) {
      if (i > 0) y += BAND_GAP
      group.y0 = y
      for (const s of group.stages) { yOf[s] = y + ROW / 2; y += ROW }
      group.y1 = y
    }
    return { rows, yOf, height: y + PAD.b }
  }, [points])

  if (!board || points.length < 5) return null

  const maxTotal = Math.max(...points.map(p => p.total))
  const maxTrailing = Math.max(...points.map(p => p.trailing || 0))
  const x = v => PAD.l + (v / maxTotal) * (W - PAD.l - PAD.r)
  const H = layout.height

  // Deterministic vertical spread so points at the same stage and similar total
  // do not sit exactly on top of one another. Index-based, never random, so the
  // chart renders identically every time.
  const jitter = i => ((i % 5) - 2) * 4.4

  const modalities = [...new Set(points.map(p => p.modality).filter(Boolean))]
  const go = r => navigate(r.href)

  return (
    <figure className="border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 mb-10">
      <figcaption className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Investment</p>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">
            Capital raised against verified stage
          </h2>
          <p className="text-[13px] text-muted font-sans mt-1">
            {points.length} companies whose stage is traceable to a trial record or an FDA decision.
            Point size is capital raised in the last 24 months.
          </p>
        </div>
        <button onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          className="text-[11px] font-sans text-muted underline decoration-rule underline-offset-2 hover:text-ink">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </figcaption>

      <div className="mb-3 pb-1 flex flex-nowrap items-center gap-x-3 overflow-x-auto text-[11px] font-sans">
        <span className="shrink-0 uppercase tracking-[0.08em] text-muted/70">Modality</span>
        {modalities.map(m => (
          <span key={m} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted">
            <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: MODALITY_COLOR[m] }} />
            {MODALITY_LABELS[m]}
          </span>
        ))}
      </div>

      {asTable ? <ScatterTable points={points} /> : (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto min-w-[560px]" role="img"
            aria-label={`Capital raised against verified stage for ${points.length} companies, banded into clinical evidence and FDA authorisation.`}>
            {niceTicks(maxTotal).map(v => (
              <g key={v}>
                <line x1={x(v)} x2={x(v)} y1={PAD.t} y2={H - PAD.b} stroke="#E4E2DC" strokeWidth="1" />
                <text x={x(v)} y={H - PAD.b + 16} textAnchor="middle"
                  className="fill-muted" style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
                  {v === 0 ? '$0' : fmtUsd(v)}
                </text>
              </g>
            ))}
            <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - PAD.b + 33} textAnchor="middle"
              className="fill-muted" style={{ fontSize: 10.5, letterSpacing: '0.08em' }}>
              TOTAL PRIVATE CAPITAL RAISED
            </text>

            {layout.rows.map(group => (
              <g key={group.band.id}>
                <text x={4} y={group.y0 - 4} className="fill-muted/70"
                  style={{ fontSize: 9.5, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                  {group.band.label}
                </text>
                <line x1={PAD.l - 10} x2={W - PAD.r} y1={group.y0 - 1} y2={group.y0 - 1}
                  stroke="#E4E2DC" strokeWidth="1" />
                {group.stages.map(s => (
                  <text key={s} x={PAD.l - 12} y={layout.yOf[s] + 3.5} textAnchor="end"
                    className="fill-ink-soft" style={{ fontSize: 11.5 }}>
                    {STAGE_LABELS[s]}
                  </text>
                ))}
              </g>
            ))}

            {points.map((p, i) => {
              const cx = x(p.total), cy = layout.yOf[p.furthestStage] + jitter(i)
              const label = `${p.name}. ${fmtUsd(p.total)} raised. ${STAGE_LABELS[p.furthestStage]}.`
                + (p.modality ? ` ${MODALITY_LABELS[p.modality]}.` : '')
                + (p.trailing ? ` ${fmtUsd(p.trailing)} in the last 24 months.` : ' No round in the last 24 months.')
              return (
                <g key={p.id} role="link" tabIndex={0} aria-label={label}
                  onClick={() => go(p)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(p) } }}
                  className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-ink">
                  <title>{label}</title>
                  <circle cx={cx} cy={cy} r={rOf(p.trailing, maxTrailing)}
                    fill={MODALITY_COLOR[p.modality] || '#6B7280'} fillOpacity="0.72"
                    stroke="#FFFFFF" strokeWidth="1" />
                </g>
              )
            })}
          </svg>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-rule text-[11.5px] font-sans text-muted leading-relaxed space-y-1.5">
        <p>
          The two bands are different regulatory routes, not steps in one sequence. A cleared 510(k)
          device is not a later stage of a pivotal trial, so positions are comparable within a band
          and not across the divide.
        </p>
        <p>
          Within the clinical band the two are weakly and positively related, and the sample is too
          small to call it: Spearman rho 0.35 across 19 companies, with a confidence interval that
          crosses zero. In the authorisation band every company sits at 510(k) cleared, so there is
          no spread to read a trend from. Measured 29 July 2026.
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
              <td className="py-1.5 pr-2 font-mono tabular-nums text-right text-ink">{fmtUsd(p.total)}</td>
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
