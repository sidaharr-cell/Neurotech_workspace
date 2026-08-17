import { useState, useEffect, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import {
  getFundingBoard, rankFunding, filterFunding, sortTitle, SORTS, DEFAULT_SORT, DEFAULT_STATUS_FILTER,
  STATUS_VALUES, HIDDEN_BY_DEFAULT, STATUS_LABELS, MODALITY_LABELS, STAGE_LABELS,
  STAGE_ORDER, unavailableLabel, INCLUSION_RULE, MODALITY_COLOR,
  MODALITY_DESCRIPTIONS, fmtUsd, fmtMonthYear, fmtDay,
} from '../lib/fundingBoard'
import { InfoTip } from './ui'

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
        <span className="text-muted"> · {fmtMonthYear(row.latestDate)}</span>
      </>
    )
  }
  const r = unavailableLabel(row)
  return <span className="text-muted/70 font-sans text-[11px] twoup:text-[12px]" title={r.long}>{r.short}</span>
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

/** One control per row, label in a fixed-width column so the three rows line up
 *  down their left edge whatever the controls beside them are. */
function ControlRow({ label, children }) {
  return (
    <div className="flex items-center gap-2 w-max twoup:w-auto">
      {/* Narrower in the two-up layout, where every pixel of this strip is one
          the modality row is short of. It still holds a column, so the three
          rows keep their left edge. */}
      <span className="w-[72px] twoup:w-14 shrink-0 uppercase tracking-[0.08em] text-muted/70">
        {label}
      </span>
      {/* Scrolls rather than folds at narrow VIEWPORTS, which is the older rule
          and still right there: folding used to push the rows below it around.
          In the two-up layout it wraps instead, because the modality row is
          668px of chips and no split of the page fits that — it was hiding the
          last chip behind a scroll a reader had no reason to look for. `w-auto`
          on the wrapper is what allows it: `w-max` alone sizes to max-content
          and nothing inside it can ever wrap. */}
      <div className="flex flex-nowrap twoup:flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

/** The filter state a page can lift out and share with the scatter below. */
export const DEFAULT_FUNDING_FILTERS = {
  statuses: DEFAULT_STATUS_FILTER,
  modalities: [],
  stageMin: null,
}

/**
 * `board` lets a page fetch once and share it with the scatter. Left out, the
 * chart fetches for itself and stays a drop-in component.
 *
 * `filters` and `onFiltersChange` are the same bargain for the controls. These
 * three dimensions describe a company, not a bar, so the scatter directly below
 * this chart answers to them as well; a page that passes them owns them, and
 * one that does not gets its own state as before. Sort and the table toggle
 * stay internal, because they are properties of this ranking and mean nothing
 * to a scatter.
 */
export default function FundingChart({
  limit = 20, board: given = null, filters = null, onFiltersChange = null, className = '',
}) {
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(!given)
  const board = given || fetched
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [own, setOwn] = useState(DEFAULT_FUNDING_FILTERS)
  const [asTable, setAsTable] = useState(false)

  const active = filters || own
  const { statuses, modalities, stageMin } = active
  const update = patch => (onFiltersChange || setOwn)({ ...active, ...patch })
  const setStatuses = v => update({ statuses: v })
  const setModalities = v => update({ modalities: v })
  const setStageMin = v => update({ stageMin: v })

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

  /**
   * The modalities offered as filters: every one that holds a company under the
   * other active filters, across the whole board rather than the visible top N.
   *
   * Reading them off `data` did two wrong things. It dropped the row the moment
   * you picked one, because the result then held a single modality. And it
   * never offered digital therapeutic at all, because none of its six companies
   * raised enough to enter the top 20 by capital, which is the exact case the
   * filter is for. A modality with no companies at all is still not offered:
   * computational neuroscience holds none, and a filter that can only ever
   * empty the chart is not a filter.
   */
  const modalityOptions = useMemo(() => {
    if (!board) return []
    const present = new Set(filterFunding(board.rows, { statuses, stageMin }).map(r => r.modality))
    return Object.keys(MODALITY_LABELS).filter(m => present.has(m) || modalities.includes(m))
  }, [board, statuses, stageMin, modalities])

  // Held open on an empty result, because the filters that emptied it are the
  // only way back out of it.
  if (loading || !board || !board.rows.length) return null

  const barOf = r => (sort === 'trailing_24mo' ? r.trailing
    : sort === 'latest_raise_size' ? r.latestAmount : r.total)
  const max = Math.max(...data.map(barOf), 1)

  const hidden = board.rows.filter(r => HIDDEN_BY_DEFAULT.includes(r.status)).length
  const showingHidden = HIDDEN_BY_DEFAULT.every(s => statuses.includes(s))
  const anyPartial = data.some(r => r.partialTotal)

  const toggleModality = m =>
    setModalities(modalities.includes(m) ? modalities.filter(x => x !== m) : [...modalities, m])

  return (
    // Three bands — head, plot, caption — so the row above can align this card
    // against the one beside it with `grid-rows-subgrid`. See Companies.jsx.
    <figure className={`flex flex-col border border-rule rounded-sm bg-canvas/50 p-5 sm:p-6 ${className}`}>
      {/* A column, matching the scatter: the controls sit on the bottom of the
          head band, directly above the rows they filter. */}
      <div className="flex flex-col">
      {/* The table toggle lives up here rather than in a strip of its own,
          which is where the scatter has always kept it. That strip held only
          this and the acquired/defunct switch, and cost the head a whole row. */}
      <figcaption className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Investment</p>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-ink">
            {data.length ? sortTitle(sort, data.length) : 'Neurotech companies by private capital raised'}
          </h2>
        </div>
        <button onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          className="text-[11px] font-sans text-muted underline decoration-rule underline-offset-2 hover:text-ink">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </figcaption>

      {/* ── Controls ────────────────────────────────────────────────────────
          Sort, modality and minimum stage each hold a row of their own, in a
          fixed order. No control moves when the result set changes. */}
      <div className="mt-auto mb-3 space-y-2 pb-1 overflow-x-auto text-[11px] font-sans">
        <ControlRow label="Sort">
          {SORTS.map(s => (
            <button key={s.id} onClick={() => setSort(s.id)} aria-pressed={sort === s.id}
              className={`text-[12px] font-sans px-2.5 py-1 rounded-full border transition-colors ${
                sort === s.id ? 'bg-ink text-paper border-ink'
                  : 'bg-paper text-ink-soft border-rule hover:border-ink'}`}>
              {s.label}
            </button>
          ))}
        </ControlRow>

        {modalityOptions.length > 0 && (
          <ControlRow label="Modality">
            {/* The description sits OUTSIDE the button and is referenced, not
                nested. On the button, `title` would become the accessible name
                and bury the label; inside it, the text would be absorbed into
                that name. Referenced, the button is still called "Implanted
                BCI" and the sentence is read after it. */}
            {modalityOptions.map(m => (
              <Fragment key={m}>
                <button onClick={() => toggleModality(m)}
                  aria-pressed={modalities.includes(m)}
                  title={MODALITY_DESCRIPTIONS[m]}
                  aria-label={MODALITY_LABELS[m]}
                  aria-describedby={`modality-desc-${m}`}
                  className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm border transition-colors ${
                    modalities.includes(m) ? 'border-ink text-ink bg-paper' : 'border-rule text-muted hover:border-ink'}`}>
                  <span aria-hidden className="w-2 h-2 rounded-[1px] shrink-0"
                    style={{ background: MODALITY_COLOR[m] }} />
                  {MODALITY_LABELS[m]}
                </button>
                <span id={`modality-desc-${m}`} className="sr-only">{MODALITY_DESCRIPTIONS[m]}</span>
              </Fragment>
            ))}
            {modalities.length > 0 && (
              <button onClick={() => setModalities([])}
                className="ml-1 text-muted underline decoration-rule underline-offset-2 hover:text-ink">
                Clear
              </button>
            )}
          </ControlRow>
        )}

        <ControlRow label="Min stage">
          <select value={stageMin || ''} onChange={e => setStageMin(e.target.value || null)}
            aria-label="Minimum verified stage"
            className="bg-paper border border-rule rounded-sm px-1.5 py-0.5 text-[11px] text-ink-soft">
            <option value="">Any</option>
            {STAGE_ORDER.filter(s => s !== 'withdrawn').map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </ControlRow>
      </div>

      </div>

      <div>
      {!data.length ? (
        <p className="py-6 text-[13px] font-sans text-muted border-t border-rule">
          No companies match these filters.
        </p>
      ) : asTable ? <FundingTable rows={data} /> : (
        // Below the min-width the card scrolls sideways. Squeezing instead cost
        // the bars their length, which is the one thing this chart is read for.
        // The fixed columns and gaps come to 580px, so the floor is that plus a
        // 240px bar column: anything narrower scrolls rather than shortens.
        //
        // From `twoup` the card holds 45% of the page, so two columns go and
        // the rest tighten. Stage goes because the figure beside it is entirely
        // about stage and the table view still carries it; dropping the latest
        // raise instead would blank the column two of the four sorts are named
        // after. Rank goes because it is the one column that says nothing the
        // layout does not: the rows are sorted by the bar, so the number just
        // counts them. The 32px that buys pays for the type below.
        <div className="overflow-x-auto">
          <div className="min-w-[820px] twoup:min-w-[500px]">
          <div className="flex items-center gap-3 twoup:gap-2 pb-1.5 mb-1 border-b border-rule text-[10px] twoup:text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-muted/70">
            <span className="w-6 shrink-0 twoup:hidden" />
            <span className="w-52 twoup:w-36 shrink-0 text-right">Company</span>
            <span className="flex-1" />
            <span className="w-28 shrink-0 twoup:hidden">Stage</span>
            <span className="w-16 shrink-0 text-right">Total</span>
            <span className="w-28 twoup:w-32 shrink-0 text-right">Latest</span>
          </div>

          <div>
            {data.map((r, i) => (
              <Link
                key={r.id} to={r.href} aria-label={rowLabel(r)}
                className="flex items-center gap-3 twoup:gap-2 py-[3px] rounded-sm group
                           hover:bg-paper focus:outline-none focus-visible:ring-2
                           focus-visible:ring-accent focus-visible:ring-offset-1">
                <span className="w-6 shrink-0 twoup:hidden text-right text-[11px] font-mono tabular-nums text-muted/70">
                  {r.rank}
                </span>
                {/* flex-wrap, so a long name and its status badge stack rather
                    than widen the column the rest of the rows are aligned to. */}
                <span className="w-52 twoup:w-36 shrink-0 flex flex-wrap items-center justify-end gap-x-1.5 min-w-0">
                  <span aria-hidden className="w-2 h-2 rounded-[1px] shrink-0"
                    style={{ background: MODALITY_COLOR[r.modality] || 'transparent' }}
                    title={MODALITY_LABELS[r.modality] || ''} />
                  <span className="text-[12.5px] twoup:text-[13px] font-sans text-ink-soft group-hover:text-accent
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
                <span className="w-28 shrink-0 flex twoup:hidden">
                  <StageBadge row={r} />
                </span>
                <span className="w-16 shrink-0 text-[12px] twoup:text-[12.5px] font-mono text-ink tabular-nums text-right">
                  {fmtUsd(r.total) || '—'}
                  {r.partialTotal && <sup className="text-muted" title="Private capital only">{PARTIAL}</sup>}
                </span>
                <span className="w-28 twoup:w-32 shrink-0 text-[11px] twoup:text-[12px] font-mono tabular-nums text-right whitespace-nowrap">
                  <LatestRaise row={r} />
                </span>
              </Link>
            ))}
          </div>
          </div>
        </div>
      )}
      </div>

      {/* ── Caption ──────────────────────────────────────────────────────
          Two lines: what the dagger means, and how much of the field the
          figure covers. Everything definitional moved up to the standfirst and
          its tip, because it describes the set rather than the marks.

          The rule on top of this block is the one that has to line up with the
          rule on the other card, which is why the caption is its own grid band
          rather than something pushed down by `mt-auto`. */}
      <div className="mt-auto twoup:mt-0 pt-3 border-t border-rule text-[11px] twoup:text-[12px] font-sans text-muted leading-relaxed space-y-1">
        {anyPartial && (
          <p><sup>{PARTIAL}</sup> Excludes capital raised on the public markets or through an
            acquirer.</p>
        )}
        {/* Source, coverage and date on one line. The scope rule is not spelled
            out here — the title says these are neurotech companies and the tip
            carries the boundary for anyone testing a particular one. */}
        <p>
          Private capital, from SEC Form D filings.{' '}
          {board.meta.fundedCount} of {board.meta.organizationsTracked} tracked companies have a
          sourced figure.
          {board.meta.lastIngestedAt && <> Last updated {fmtDay(board.meta.lastIngestedAt)}.</>}{' '}
          <InfoTip label="What counts as a neurotech company">{INCLUSION_RULE}</InfoTip>
        </p>
        {/* The acquired-and-defunct switch came down here with the strip that
            used to hold it. It belongs with the caption anyway: it says what
            the default view leaves out, which is the same kind of statement as
            the coverage line above it, and it is the only way back to those
            companies — so it moved rather than went. */}
        {hidden > 0 && (
          <p>
            {showingHidden
              ? `Showing ${hidden} acquired or defunct ${hidden === 1 ? 'company' : 'companies'}.`
              : `${hidden} acquired or defunct ${hidden === 1 ? 'company' : 'companies'} hidden.`}{' '}
            <button
              onClick={() => setStatuses(showingHidden ? DEFAULT_STATUS_FILTER : STATUS_VALUES)}
              className="underline decoration-rule underline-offset-2 hover:text-ink">
              {showingHidden ? 'Hide' : 'Show'}
            </button>
          </p>
        )}
      </div>
    </figure>
  )
}

/** The same data as a semantic table, for screen readers and for anyone who
 *  would rather read the numbers than compare the bars. */
function FundingTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      {/* min-w over w-full: inside an overflow-x-auto parent, w-full shrinks to
          the parent and the cells wrap. A min-width overflows and scrolls. */}
      <table className="w-full min-w-[880px] text-[12px] font-sans border-collapse">
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
            <th scope="col" className="py-1.5 pr-2 font-semibold text-right">Latest raise</th>
            <th scope="col" className="py-1.5 font-semibold">Source</th>
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
              <td className="py-1.5 pr-2 font-mono tabular-nums text-right">
                <LatestRaise row={r} />
              </td>
              {/* The latest raise is one filing, so it links to that filing. The
                  total is a sum across filings and has no single document, so it
                  links to the list of them on the company page. */}
              <td className="py-1.5 text-[11.5px] whitespace-nowrap">
                {r.latestSourceUrl && r.latestAmount > 0 && (
                  <a href={r.latestSourceUrl} target="_blank" rel="noreferrer"
                    className="text-accent hover:underline"
                    title={`SEC Form D filing for the ${fmtUsd(r.latestAmount)} raise`}>
                    Latest filing
                  </a>
                )}
                {r.latestSourceUrl && r.latestAmount > 0 && <span className="text-muted"> · </span>}
                <Link to={r.href} className="text-accent hover:underline">All filings</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
