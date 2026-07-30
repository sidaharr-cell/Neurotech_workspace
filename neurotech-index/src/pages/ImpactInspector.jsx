/**
 * ImpactInspector — the internal inspection view. Spec section 9.3.
 *
 * "It MUST show the full ImpactScore object for any item, including every
 * justification, referent, consulted record, gate, flag, and validation reset.
 * Access-gate it however you like, but it has to exist before the sort ships."
 *
 * The reasoning, from the same section: "Hiding the numbers means users cannot
 * self-correct for miscalibration and their disagreement never becomes legible
 * feedback. The inspection view is now the only place the rubric is visible."
 *
 * This is the one surface where dimension names, scores and multipliers are
 * allowed to appear. Everywhere else spec 9.1 forbids them.
 *
 * It matters more than it would have. Phase 5 calibration failed three runs
 * (docs/potential-impact-phase5-result.md), so when a ranking looks wrong this
 * is where someone establishes why: which records were actually consulted, what
 * the referent was, which validators fired, and what capped the score.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getImpactScoreDetail } from '../lib/data'
import { FLAGS } from '../lib/flags'

const DIMS = [
  ['fd', 'FD', 'frontier delta'],
  ['lv', 'LV', 'leverage'],
  ['tr', 'TR', 'transferability'],
  ['gap', 'GAP', 'evidence gap'],
  ['gate', 'GATE', 'translational gating'],
  ['meth', 'METH', 'methodological precedent'],
]

const Row = ({ label, children }) => (
  <div className="flex gap-3 py-1.5 border-b border-line/40 last:border-0">
    <div className="w-44 shrink-0 text-[0.8rem] text-ink-soft font-mono">{label}</div>
    <div className="text-[0.9rem] min-w-0 break-words">{children}</div>
  </div>
)

export default function ImpactInspector() {
  const { itemType, itemId } = useParams()
  const [detail, setDetail] = useState(undefined)

  useEffect(() => {
    let live = true
    getImpactScoreDetail(itemType, itemId).then(d => { if (live) setDetail(d) })
    return () => { live = false }
  }, [itemType, itemId])

  if (!FLAGS.IMPACT_INSPECTOR) {
    return <div className="p-8 text-ink-soft">The impact inspector is not enabled in this build.</div>
  }
  if (detail === undefined) return <div className="p-8 text-ink-soft">Loading.</div>
  if (!detail) {
    return (
      <div className="p-8">
        <p className="text-ink-soft">No score stored for this item.</p>
        <p className="mt-2 text-[0.85rem] text-ink-soft">
          Only a recent slice of the corpus has been scored. An unscored item does
          not appear in the potential impact sort at all.
        </p>
      </div>
    )
  }

  const { score, resets, extraction, consulted } = detail

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header>
        <p className="text-[0.75rem] uppercase tracking-wide text-ink-soft">Internal inspection</p>
        <h1 className="font-display text-2xl mt-1">Potential impact, full record</h1>
        <p className="mt-2 text-[0.85rem] text-ink-soft">
          Rubric {score.rubric_version} and run {score.run_label}. Phase 5 calibration
          has not passed, so this ordering is offered behind a flag and is not a
          default sort. Every number below is internal and appears nowhere in the
          public interface.
        </p>
      </header>

      <section>
        <h2 className="font-display text-lg mb-2">What the user sees</h2>
        <Row label="reason">{score.user_facing_reason || <em className="text-ink-soft">none</em>}</Row>
        <Row label="tags">{(score.tags || []).join(', ') || <em className="text-ink-soft">none</em>}</Row>
        <Row label="horizon">{score.horizon || <em className="text-ink-soft">not set</em>}</Row>
        {score.reason_from_template && (
          <Row label="note">
            This sentence is a template built from the tags. The model produced rubric
            vocabulary twice, so validator rule 7 fell back rather than surfacing it.
          </Row>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg mb-2">Composition</h2>
        <Row label="potential_impact">{Number(score.potential_impact).toFixed(4)}</Row>
        <Row label="path_taken">
          {score.path_taken || 'none'}
          <span className="text-ink-soft"> — base {Number(score.base ?? 0).toFixed(3)}
            {' '}× evidence {Number(score.multiplier ?? 0).toFixed(2)}
            {' '}× recency {Number(score.recency ?? 0).toFixed(3)}</span>
        </Row>
        <Row label="evidence_grade">{score.evidence_grade || '—'} ({score.evidence_variant})</Row>
        <Row label="translational_distance">{score.translational_distance ?? '—'}</Row>
        <Row label="uncertainty">{score.uncertainty || '—'}</Row>
        {(score.gates_triggered || []).length > 0 && (
          <Row label="gates_triggered">{score.gates_triggered.join(', ')}</Row>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg mb-2">Dimensions</h2>
        {DIMS.map(([key, code, name]) => {
          const d = score[key]
          if (!d) return null
          return (
            <div key={key} className="py-2 border-b border-line/40 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[0.8rem]">{code}</span>
                <span className="text-ink-soft text-[0.8rem]">{name}</span>
                <span className="ml-auto font-mono">{d.score}</span>
              </div>
              {d.justification && <p className="mt-1 text-[0.9rem]">{d.justification}</p>}
              {d.referent && (
                <p className="mt-1 text-[0.85rem] text-ink-soft">
                  <span className="font-mono">referent:</span> {d.referent}
                </p>
              )}
              {(d.beneficiaries || []).length > 0 && (
                <p className="mt-1 text-[0.85rem] text-ink-soft">
                  <span className="font-mono">beneficiaries:</span> {d.beneficiaries.join(', ')}
                </p>
              )}
              {(d.unlocks || []).length > 0 && (
                <p className="mt-1 text-[0.85rem] text-ink-soft">
                  <span className="font-mono">unlocks:</span> {d.unlocks.join(', ')}
                </p>
              )}
              {(d.paired_axes || []).length > 0 && (
                <p className="mt-1 text-[0.85rem] text-ink-soft">
                  <span className="font-mono">paired_axes:</span> {d.paired_axes.join('  ⟷  ')}
                </p>
              )}
            </div>
          )
        })}
      </section>

      <section>
        <h2 className="font-display text-lg mb-2">What capped it</h2>
        <Row label="fd_ceiling">
          {score.fd_ceiling} — from record coverage in this subfield
        </Row>
        <Row label="input_granularity">{score.input_granularity}</Row>
        {(score.ceilings_applied || []).length > 0 ? (
          (score.ceilings_applied || []).map((c, i) => (
            <Row key={i} label="capped">
              {c.dimension} {c.from} → {c.to} ({c.reason})
            </Row>
          ))
        ) : <Row label="capped">nothing was capped</Row>}
      </section>

      <section>
        <h2 className="font-display text-lg mb-2">
          Frontier records consulted ({consulted.length})
        </h2>
        {consulted.length === 0 ? (
          <p className="text-[0.85rem] text-ink-soft">
            None. A frontier delta or evidence gap above zero with nothing consulted
            is reset to zero by validator rule 4.
          </p>
        ) : consulted.map(r => (
          <div key={r.id} className="py-1.5 border-b border-line/40 last:border-0 text-[0.85rem]">
            <span className="font-mono text-ink-soft">[{r.axis_type}]</span> {r.axis}
            {' = '}<strong>{r.current_value}</strong>
            {r.confidence && <span className="text-ink-soft"> ({r.confidence})</span>}
            {r.source_url && (
              <a href={r.source_url} target="_blank" rel="noreferrer"
                className="ml-2 underline text-ink-soft">source</a>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-display text-lg mb-2">Claim against demonstration</h2>
        <Row label="claimed">{extraction?.claimed || score.claim_vs_demonstration?.claimed || '—'}</Row>
        <Row label="demonstrated">
          {extraction?.demonstrated || score.claim_vs_demonstration?.demonstrated
            || <em className="text-ink-soft">nothing disclosed</em>}
        </Row>
        <Row label="gap_flagged">{String(!!score.gap_flagged)}</Row>
        <Row label="rhetorical_markers">
          {score.rhetorical_marker_count} recorded.
          <span className="text-ink-soft"> Withheld from the scorer; recorded for
            monitoring only and never evidence.</span>
        </Row>
      </section>

      <section>
        <h2 className="font-display text-lg mb-2">Validator resets ({resets.length})</h2>
        {resets.length === 0 ? (
          <p className="text-[0.85rem] text-ink-soft">No section 8 rule fired on this item.</p>
        ) : resets.map(r => (
          <div key={r.id} className="py-1.5 border-b border-line/40 last:border-0 text-[0.85rem]">
            <span className="font-mono">rule {r.rule}</span> — {r.field}:
            {' '}{r.from_value ?? 'null'} → {r.to_value ?? 'null'}
            {r.note && <span className="text-ink-soft"> ({r.note})</span>}
          </div>
        ))}
      </section>

      <p className="text-[0.8rem] text-ink-soft">
        <Link to="/how-it-works" className="underline">How ranking works</Link>
      </p>
    </div>
  )
}
