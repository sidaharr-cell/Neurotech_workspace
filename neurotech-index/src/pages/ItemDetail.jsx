import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FileQuestion } from 'lucide-react'
import { getNewsItem } from '../lib/data'
import { storyPicture, objectFitOf, focusOf } from '../lib/image'
import { ImageCredit } from '../components/Figure'
import { Loader, EmptyState, Kicker, DeviceClassLabels, fmtDate, typeWord } from '../components/ui'

/**
 * The story's photograph, and where it came from.
 *
 * A card on the home page runs a picture at 300 pixels with a source name
 * under it. This is the page a reader reaches by clicking that card, and it is
 * where the attribution is actually legible: the same picture at full measure,
 * the same one-line credit, and that line is a link to the file's own
 * description page — the licence, the photographer, the terms. Minimal on
 * purpose. A reader who wants to know where a picture came from gets one line
 * and one click; a reader who does not is not made to read a rights notice.
 *
 * The picture is asked for through storyPicture rather than read off the
 * record, so this page and the home page agree: what the ledger has promised
 * to a different story does not appear here either.
 *
 * The frame is 16:9 and the picture fills it, cropped at the focal point the
 * daily run found — the same geometry as every other frame on the site, so a
 * subject that survives a card survives this.
 */
function StoryPhoto({ item }) {
  const img = storyPicture(item)
  if (!img) return null
  const fit = objectFitOf(img)
  return (
    <figure className="mt-8">
      <div className="w-full aspect-[16/9] overflow-hidden bg-canvas">
        <img
          src={img.url}
          alt=""
          decoding="async"
          style={fit === 'cover' ? { objectPosition: focusOf(img) } : undefined}
          className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        />
      </div>
      <figcaption>
        <ImageCredit img={img} />
      </figcaption>
    </figure>
  )
}

function authorsOf(item) {
  const a = item.metadata?.authors
  if (!a) return null
  const list = Array.isArray(a) ? a : [a]
  if (!list.length) return null
  return list.slice(0, 12).join(', ') + (list.length > 12 ? ', et al.' : '')
}

export default function ItemDetail() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getNewsItem(id).then(d => { if (alive) { setItem(d); setLoading(false) } })
    return () => { alive = false }
  }, [id])

  if (loading) return <div className="max-w-prose mx-auto px-4 py-10"><Loader label="Loading…" /></div>
  if (!item) return <div className="max-w-prose mx-auto px-4 py-16"><EmptyState icon={FileQuestion} title="Not found">This item isn’t in the index.</EmptyState></div>

  const authors = authorsOf(item)
  const significance = item.metadata?.significance || item.summary
  const cites = item.metadata?.citationCount ?? 0

  return (
    <article className="max-w-prose mx-auto px-4 sm:px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <div className="flex items-center gap-3 mb-3">
        <Kicker>{typeWord(item.entry_type)}</Kicker>
        <DeviceClassLabels entity={item} />
      </div>

      <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-[1.1] font-semibold text-ink tracking-[-0.015em]">
        {item.title}
      </h1>

      {authors && <p className="mt-4 text-[15px] text-ink-soft font-body leading-relaxed">{authors}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted font-sans">
        {item.source && <span>{item.source}</span>}
        {item.published_at && <><span aria-hidden>·</span><span>{fmtDate(item.published_at)}</span></>}
        {cites > 0 && <><span aria-hidden>·</span><span>{cites.toLocaleString()} citations</span></>}
      </div>

      <StoryPhoto item={item} />

      <div className="mb-8" />

      {item.entry_type === 'trial' && (
        <dl className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 border-y border-rule py-5">
          {[
            ['Status', (item.metadata?.status || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())],
            ['Phase', item.metadata?.phase],
            ['Sponsor', item.metadata?.sponsor],
            ['Conditions', (item.metadata?.conditions || []).join(', ')],
            ['Interventions', (item.metadata?.interventions || []).join(', ')],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-0.5">{k}</dt>
              <dd className="text-[15px] text-ink font-body leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {significance && (
        <div className="mb-8">
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2">{item.entry_type === 'trial' ? 'About this trial' : 'Why it matters'}</p>
          <p className="text-[1.15rem] leading-[1.7] text-ink font-body">{significance}</p>
        </div>
      )}

      {item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-ink text-paper text-[14px] font-sans font-medium px-5 py-2.5 rounded-sm hover:bg-accent transition-colors">
          Read the full source <ExternalLink className="w-4 h-4" />
        </a>
      )}

      {/* Provenance for the paragraph above, and only when there is one — the
          note used to print on records with no summary to disclaim.

          A trial's text is ClinicalTrials.gov's own brief summary, stored
          verbatim by scripts/trials.js with no model in the path, so claiming a
          model wrote it was simply wrong. It cannot be keyed on the absence of
          metadata.significance instead: news falls back to item.summary too,
          and that one IS model-written. The entry type is what distinguishes
          them. */}
      {significance && (
        <p className="mt-6 text-[12px] text-muted font-sans italic">
          {item.entry_type === 'trial'
            ? 'Summary from the ClinicalTrials.gov record · verify against the original source.'
            : 'Summary generated by AI · verify against the original source.'}
        </p>
      )}
    </article>
  )
}
