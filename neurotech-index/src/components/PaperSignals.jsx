import { Code2, Database, AlertTriangle, CopyCheck } from 'lucide-react'

/**
 * Reproducibility and provenance signals on a paper (Phase 5). All are shown
 * only when the underlying signal is actually present -- an absent code/data
 * link means "not found in the abstract", never "none exists", and no synthesized
 * reproducibility score is computed. Color is never the only cue: every badge
 * pairs it with text (and an icon where used).
 */

const chip = 'inline-flex items-center gap-1 text-[10.5px] font-sans font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-sm border'

// Preprint (arXiv/bioRxiv) vs peer-reviewed (PubMed journal), from provenance.
export function KindBadge({ source }) {
  const preprint = source === 'arxiv' || source === 'biorxiv'
  const peer = source === 'pubmed'
  if (!preprint && !peer) return null
  return preprint
    ? <span className={`${chip} text-muted border-rule bg-canvas`}>Preprint</span>
    : <span className={`${chip} text-accent border-accent/30 bg-accent/5`}>Peer-reviewed</span>
}

/**
 * Compact signal badges for a paper row or header: code/data availability and
 * contradiction/replication. `signals` is { contradicted, replicated } (booleans
 * for a row) — the detail page renders the linked records separately.
 */
export function ReproBadges({ paper = {}, signals = {} }) {
  const code = Array.isArray(paper.code_urls) ? paper.code_urls : []
  const data = Array.isArray(paper.data_urls) ? paper.data_urls : []
  const anything = code.length || data.length || signals.contradicted || signals.replicated
  if (!anything) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {signals.contradicted && (
        <span className={`${chip} text-highlight border-highlight/40 bg-highlight/5`}><AlertTriangle className="w-3 h-3" /> Contradicted</span>
      )}
      {signals.replicated && (
        <span className={`${chip} text-accent border-accent/30 bg-accent/5`}><CopyCheck className="w-3 h-3" /> Replicated</span>
      )}
      {code.length > 0 && (
        <span className={`${chip} text-accent border-accent/30 bg-accent/5`}><Code2 className="w-3 h-3" /> Code</span>
      )}
      {data.length > 0 && (
        <span className={`${chip} text-accent border-accent/30 bg-accent/5`}><Database className="w-3 h-3" /> Data</span>
      )}
    </span>
  )
}
