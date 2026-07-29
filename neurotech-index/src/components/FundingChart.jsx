import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  getFundingBoard, rankFunding, sortTitle, SORTS, DEFAULT_SORT, DEFAULT_STATUS_FILTER,
  STATUS_VALUES, HIDDEN_BY_DEFAULT, STATUS_LABELS, MODALITY_LABELS, STAGE_LABELS,
  STAGE_ORDER, unavailableLabel, INCLUSION_RULE, MODALITY_COLOR,
  fmtUsd, fmtMonthYear, fmtDay,
} from '../lib/fundingBoard'

/** The marker on a private-only total that belongs to a company which has since
 *  listed or been acquired. The figure is real but it is not the whole story. */
const PARTIAL = '†'

function StatusBadge({ status }) {
  if (!status || status === 'private') return null
  return (
    <span className="shrink-0 text-[10px] font-sans uppercase tracking-[0.06em] px-1.5 py-px
                     rounded-sm border border-rule bg-canvas text-muted">
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function StageBadge({ row }) {
  if (!row.furthestStage) return null    // no stage is no badge, never "Unknown"
  const label = STAGE_LABELS[row.furthestStage] || row.furthestStage
  return (
    <span
      className="text-[10px] font-sans px-1.5 py-px rounded-sm border border-accent/25
                 bg-accent-soft text-accent-dark whitespace-nowrap"
      title={row.stageEvidenceId ? `Evidence: ${row.stageEvidenceId}` : undefined}
    >
      {label}
    </span>
  )
}

/** The cell that used to read `n/a` for five different situations. */
function LatestRaise({ row }) {
  if (row.latestAmount) {
    return (
      <>
        <span className="text-ink-soft">{fmtUsd(row.latestAmount)}</span>
        <span className="text-muted hidden sm:inline"> · {fmtMonthYear(row.latestDate)}</span>
      </>
    )
  }
  const r = unavailableLabel(row)
  return <span className="text-muted/70 font-sans text-[11px]" title={r.long}>{r.short}</span>
}

/** Company, total, status and stage, spoken as one sentence. */
function rowLabel(row) {
  const parts = [row.name, `${fmtUsd(row.total)} raised`]
  if (row.partialTotal) parts.push('private capital only')
  if (row.status && row.status !== 'private') parts.push(STATUS_LABELS[row.status])
  if (row.modality) parts.push(MODALITY_LABELS[row.modality])
  parts.push(row.furthestStage ? STAGE_LABELS[row.furthestStage] : 'no verified stage')
  if (!row.latestAmount) parts.push(`latest raise: ${unavailableLabel(row).short}`)
  return parts.join('. ')
}

/** `board` lets a page fetch once and share it with the scatter. Left out, the
 *  chart fetches for itself and stays a drop-in component. */
export default function FundingChart({ limit = 20, board: given = null }) {
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(!given)
  const board = given || fetched
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [statuses, setStatuses] = useState(DEFAULT_STATUS_FILTER)
  const [modalities, setModalities] = useState([])
  const [stageMin, setStageMin] = useState(null)
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    if (given) return
    let live = true
    getFundingBoard()
      .then(b => { if (live) { setFetched(b); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [given])

  const data = useMemo(
    () => (board ? rankFunding(board.rows, { sort, limit, statuses, modalities, stageMin }) : []),
    [board, sort, limit, statuses, modalities, stageMin],
  )

  if (loading || !board || !data.length) return null

  const barOf = r => (sort === 'trailing_24mo' ? r.trailing
    : sort === 'latest_raise_size' ? r.latestAmount : r.total)
  const max = Math.max(...data.map(barOf), 1)

  const hidden = board.rows.filter(r => HIDDEN_BY_DEFAULT.includes(r.status)).length
  const showingHidden = HIDDEN_BY_DEFAULT.every(s => statuses.includes(s))
  const anyPartial = data.some(r => r.partialTotal)
  const shownModalities = [...new Set(data.map(r => r.modality).filter(Boolean))]

  const toggleModality = m =>
    setModalities(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]))

  return (
    <figure className="border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 mb-10">
      <figcaption className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Investment</p>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">
            {sortTitle(sort, data.length)}
          </h2>
          <p className="text-[13px] text-muted font-sans mt-1">
            Private capital only, from SEC Form D filings. Every figure links to the filing it came from.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-sans uppercase tracking-[0.08em] text-muted/70 mr-1">Sort</span>
          {SORTS.map(s => (
            <button key={s.id} onClick={() => setSort(s.id)} aria-pressed={sort === s.id}
              className={`text-[12px] font-sans px-2.5 py-1 rounded-full border transition-colors ${
                sort === s.id ? 'bg-ink text-paper border-ink'
                  : 'bg-paper text-ink-soft border-rule hover:border-ink'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </figcaption>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-sans">
        {shownModalities.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="uppercase tracking-[0.08em] text-muted/70">Modality</span>
            {Object.keys(MODALITY_LABELS)
              .filter(m => shownModalities.includes(m) || modalities.includes(m))
              .map(m => (
                <button key={m} onClick={() => toggleModality(m)}
                  aria-pressed={modalities.includes(m)}
                  className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm border transition-colors ${
                    modalities.includes(m) ? 'border-ink text-ink bg-paper' : 'border-rule text-muted hover:border-ink'}`}>
                  <span aria-hidden className="w-2 h-2 rounded-[1px] shrink-0"
                    style={{ background: MODALITY_COLOR[m] }} />
                  {MODALITY_LABELS[m]}
                </button>
              ))}
          </div>
        )}

        <label className="flex items-center gap-1.5 text-muted">
          <span className="uppercase tracking-[0.08em] text-muted/70">Min stage</span>
          <select value={stageMin || ''} onChange={e => setStageMin(e.target.value || null)}
            className="bg-paper border border-rule rounded-sm px-1.5 py-0.5 text-[11px] text-ink-soft">
            <option value="">Any</option>
            {STAGE_ORDER.filter(s => s !== 'withdrawn').map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </label>

        {hidden > 0 && (
          <button
            onClick={() => setStatuses(showingHidden ? DEFAULT_STATUS_FILTER : STATUS_VALUES)}
            className="text-muted underline decoration-rule underline-offset-2 hover:text-ink">
            {showingHidden
              ? 'Hide acquired and defunct companies'
              : `${hidden} acquired or defunct ${hidden === 1 ? 'company' : 'companies'} hidden. Show`}
          </button>
        )}

        <button onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          className="ml-auto text-muted underline decoration-rule underline-offset-2 hover:text-ink">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {asTable ? <FundingTable rows={data} /> : (
        <>
          <div className="flex items-center gap-2 sm:gap-3 pb-1.5 mb-1 border-b border-rule text-[10px] font-sans font-semibold uppercase tracking-[0.08em] text-muted/70">
            <span className="w-5 sm:w-6 shrink-0" />
            <span className="w-28 sm:w-52 shrink-0 text-right">Company</span>
            <span className="flex-1" />
            <span className="w-28 shrink-0 hidden md:block">Stage</span>
            <span className="w-14 sm:w-16 shrink-0 text-right">Total</span>
            <span className="w-16 sm:w-28 shrink-0 text-right">Latest</span>
          </div>

          <div>
            {data.map((r, i) => (
              <Link
                key={r.id} to={r.href} aria-label={rowLabel(r)}
                className="flex items-center gap-2 sm:gap-3 py-[3px] rounded-sm group
                           hover:bg-paper focus:outline-none focus-visible:ring-2
                           focus-visible:ring-accent focus-visible:ring-offset-1">
                <span className="w-5 sm:w-6 shrink-0 text-right text-[11px] font-mono tabular-nums text-muted/70">
                  {r.rank}
                </span>
                {/* flex-wrap, so a status badge on a narrow screen drops to a
                    second line instead of pushing the name out of the card. */}
                <span className="w-28 sm:w-52 shrink-0 flex flex-wrap items-center justify-end gap-x-1.5 min-w-0">
                  <span aria-hidden className="w-2 h-2 rounded-[1px] shrink-0"
                    style={{ background: MODALITY_COLOR[r.modality] || 'transparent' }}
                    title={MODALITY_LABELS[r.modality] || ''} />
                  <span className="text-[12.5px] font-sans text-ink-soft group-hover:text-accent
                                   leading-tight break-words text-right">
                    {r.name}
                  </span>
                  <StatusBadge status={r.status} />
                </span>
                <div className="flex-1 min-w-0">
                  {barOf(r) > 0 && (
                    <div className="h-4 rounded-[2px] bg-accent"
                      style={{ width: `${Math.max((barOf(r) / max) * 100, 2)}%`, opacity: 1 - i * 0.018 }} />
                  )}
                </div>
                <span className="w-28 shrink-0 hidden md:flex">
                  <StageBadge row={r} />
                </span>
                <span className="w-14 sm:w-16 shrink-0 text-[12px] font-mono text-ink tabular-nums text-right">
                  {fmtUsd(r.total) || '—'}
                  {r.partialTotal && <sup className="text-muted" title="Private capital only">{PARTIAL}</sup>}
                </span>
                <span className="w-16 sm:w-28 shrink-0 text-[11px] font-mono tabular-nums text-right">
                  <LatestRaise row={r} />
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── Caption ─────────────────────────────────────────────────────── */}
      <div className="mt-4 pt-3 border-t border-rule text-[11.5px] font-sans text-muted leading-relaxed space-y-1.5">
        {anyPartial && (
          <p><sup>{PARTIAL}</sup> Private capital only. The figure excludes capital raised on the public
            markets or through an acquirer.</p>
        )}
        <p>{INCLUSION_RULE}</p>
        <p>
          Totals count private capital only.
          {' '}{board.meta.fundedCount} of {board.meta.organizationsTracked} tracked companies have a
          sourced funding figure.
          {board.meta.lastIngestedAt && <> Last updated {fmtDay(board.meta.lastIngestedAt)}.</>}
        </p>
      </div>
    </figure>
  )
}

/** The same data as a semantic table, for screen readers and for anyone who
 *  would rather read the numbers than compare the bars. */
function FundingTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] font-sans border-collapse">
        <caption className="sr-only">
          Neurotech companies by private capital raised, with status, modality, and furthest verified stage.
        </caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-muted/70 text-left border-b border-rule">
            <th scope="col" className="py-1.5 pr-2 font-semibold">#</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Company</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Status</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Modality</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Stage</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold text-right">Total</th>
            <th scope="col" className="py-1.5 font-semibold text-right">Latest raise</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-rule-soft">
              <td className="py-1.5 pr-2 font-mono tabular-nums text-muted/70">{r.rank}</td>
              <th scope="row" className="py-1.5 pr-2 font-normal text-left">
                <Link to={r.href} className="text-ink-soft hover:text-accent">{r.name}</Link>
              </th>
              <td className="py-1.5 pr-2 text-muted">{STATUS_LABELS[r.status] || 'Not available'}</td>
              <td className="py-1.5 pr-2 text-muted">{MODALITY_LABELS[r.modality] || 'Not available'}</td>
              <td className="py-1.5 pr-2 text-muted">
                {r.furthestStage
                  ? (r.stageEvidenceUrl
                    ? <a href={r.stageEvidenceUrl} target="_blank" rel="noreferrer"
                        className="text-accent hover:underline">{STAGE_LABELS[r.furthestStage]}</a>
                    : STAGE_LABELS[r.furthestStage])
                  : 'Not available'}
              </td>
              <td className="py-1.5 pr-2 font-mono tabular-nums text-right text-ink">
                {fmtUsd(r.total) || 'Not available'}
                {r.partialTotal && <sup className="text-muted">{PARTIAL}</sup>}
              </td>
              <td className="py-1.5 font-mono tabular-nums text-right">
                <LatestRaise row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
