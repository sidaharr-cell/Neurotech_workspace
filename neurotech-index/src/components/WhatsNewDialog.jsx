import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, ExternalLink, Mail, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchWhatsNew, formatDay, isEmail, subscribe, PREVIEW_PER_CATEGORY } from '../lib/whatsNew'

/**
 * WhatsNewDialog — the day's arrivals, over the page rather than instead of it.
 *
 * A window and not a route, on purpose. "What's new today" is a glance at what
 * the 6am run brought in, taken from wherever the reader happens to be; sending
 * them to a page would cost them their place, and coming back would cost the
 * scroll position and any facets they had set. The page stays behind, blurred,
 * because it is still where they were.
 *
 * Everything shown is read through src/lib/whatsNew.js, which is also what the
 * emailed digest is rendered from — one definition, so the mail cannot say
 * something different from the window.
 */

function Item({ item }) {
  const title = item.href
    ? <Link to={item.href} className="text-ink hover:text-accent transition-colors">{item.title}</Link>
    : item.url
      ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-accent transition-colors">
          {item.title} <ExternalLink className="inline w-3 h-3 align-baseline text-muted" aria-hidden="true" />
        </a>
      )
      : <span className="text-ink">{item.title}</span>

  return (
    <li className="py-3 border-b border-rule-soft last:border-0">
      <div className="font-serif text-[16px] leading-snug font-semibold">{title}</div>
      {/* The byline sits directly under the headline, where a byline goes, and
          darker than the source line below it: it names who did the work, which
          the journal and the phase do not. Research is the only category that
          has one; see byline() in lib/whatsNew.js. */}
      {item.byline && <div className="mt-1 font-sans text-[12px] text-ink-soft">{item.byline}</div>}
      {item.meta && <div className="mt-1 font-sans text-[12px] text-muted">{item.meta}</div>}
      {item.tldr && <p className="mt-1.5 font-serif text-[14px] leading-relaxed text-ink-soft">{item.tldr}</p>}
    </li>
  )
}

/**
 * One category, folded to its first ten.
 *
 * Every category is read in full and counted in full — the number beside the
 * heading is the day's real total, not the number of rows on screen — and the
 * rest sit behind one disclosure. Without the fold a heavy morning's Research
 * pushes every other category off the bottom of a window the reader then has to
 * scroll past to find out that trials moved at all, which is the opposite of a
 * glance. Each category keeps its own open state, so opening one does not
 * lengthen the others.
 *
 * The emailed digest is not folded: an inbox has no disclosure to open, and the
 * fold hides nothing the mail would have said differently.
 *
 * A CATEGORY WITH NOTHING IN IT STILL PRINTS, as a heading and a zero. The
 * window used to drop it, and a reader who opened a quiet morning saw Research
 * and News and had no way to tell whether trials had not moved or whether the
 * index does not follow trials at all. The zero answers that: the category is
 * tracked, and today it is empty. The emailed digest still drops its empty
 * sections — it is sent only on a day that has something, and five zeroes under
 * a heading is padding in an inbox, where it is a fact worth stating in a window
 * the reader opened to ask exactly this question.
 */
export function Section({ section }) {
  const [expanded, setExpanded] = useState(false)
  const hidden = section.items.length - PREVIEW_PER_CATEGORY
  const shown = expanded ? section.items : section.items.slice(0, PREVIEW_PER_CATEGORY)

  return (
    <section className="mt-7">
      <h3 className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-ink border-b border-rule pb-1.5">
        {section.label} <span className="text-muted">({section.items.length})</span>
      </h3>
      {!section.items.length && (
        <p className="py-3 font-sans text-[13px] text-muted">Nothing today.</p>
      )}
      <ul className="mt-1">
        {shown.map(item => <Item key={`${section.key}-${item.id}`} item={item} />)}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1 font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-accent transition-colors"
        >
          {expanded
            ? <><ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />Show fewer</>
            : <><ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />Show {hidden} more</>}
        </button>
      )}
    </section>
  )
}

/**
 * The address goes straight to Supabase under an insert-only policy; there is
 * no server here to post a form to. The confirmation is deliberately plain
 * about when the first mail arrives, because "subscribed!" on a page whose
 * digest is sent once a day at 6am UTC invites a reader to wonder why nothing
 * came.
 */
function EmailSignup() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle')   // idle | sending | done | error
  const [message, setMessage] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    if (state === 'sending') return
    if (!isEmail(email)) { setState('error'); setMessage('That does not look like an email address.'); return }
    setState('sending')
    const res = await subscribe(supabase, email)
    if (res.ok) {
      setState('done')
      setMessage(res.already
        ? 'That address is already on the list. The next digest goes out after tomorrow\'s run.'
        : 'Done. The digest arrives each morning, just after the daily run.')
    } else {
      setState('error')
      setMessage(res.error)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 border border-rule rounded-sm bg-canvas/50 p-4">
      <label htmlFor="whats-new-email" className="block font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">
        <Mail className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" aria-hidden="true" />
        Get this by email
      </label>
      <p className="mt-1.5 font-serif text-[14px] text-ink-soft">
        The same list, sent each morning right after the daily run.
      </p>
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <input
          id="whats-new-email"
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); if (state === 'error') { setState('idle'); setMessage(null) } }}
          placeholder="you@example.com"
          autoComplete="email"
          className="flex-1 border border-rule rounded-sm px-3 py-2 font-sans text-[14px] text-ink bg-paper focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={state === 'sending' || state === 'done'}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-sm bg-accent text-paper font-sans text-[13px] font-semibold uppercase tracking-[0.08em] hover:bg-accent-dark transition-colors disabled:opacity-60"
        >
          {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {state === 'done' && <Check className="w-4 h-4" aria-hidden="true" />}
          {state === 'done' ? 'Signed up' : 'Email it to me'}
        </button>
      </div>
      {message && (
        <p role="status" className={`mt-2 font-sans text-[13px] ${state === 'error' ? 'text-highlight' : 'text-muted'}`}>
          {message}
        </p>
      )}
    </form>
  )
}

export default function WhatsNewDialog({ open, onClose }) {
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  // Read on open, and again only if the day has turned over while the tab sat
  // there. A reader who opens the window twice in a morning is shown the same
  // list without a second round trip.
  useEffect(() => {
    if (!open) return
    const todayISO = new Date().toISOString().slice(0, 10)
    if (digest?.day === todayISO) return
    let live = true
    setLoading(true)
    fetchWhatsNew(supabase)
      .then(d => { if (live) setDigest(d) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, digest?.day])

  // Escape closes, the page behind does not scroll while it is open, and focus
  // starts inside the window rather than back at the top of the document.
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  // Every category, empty ones included, so a quiet morning says which of them
  // was quiet rather than leaving the reader to guess whether the index follows
  // trials at all. A day with nothing at all in it is the exception: seven
  // zeroes says less than one sentence does, so that case gets the sentence.
  const sections = digest?.total ? digest.sections : []

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-0 sm:p-6">
      {/* The page stays visible behind, softened rather than hidden. */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[3px] animate-fade-in" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="relative w-full sm:max-w-3xl max-h-[100dvh] sm:max-h-[85vh] overflow-y-auto bg-paper border border-rule shadow-2xl sm:rounded-sm animate-slide-down"
      >
        <div className="sticky top-0 bg-paper/95 backdrop-blur-sm border-b border-ink px-5 sm:px-8 py-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="whats-new-title" className="font-serif text-2xl sm:text-[2rem] font-semibold text-ink leading-tight">
              What&apos;s new today
            </h2>
            <p className="mt-1 font-sans text-[12px] text-muted">
              {loading && !digest
                ? 'Reading today\'s arrivals…'
                : digest
                  ? `${formatDay(digest.day)} · ${digest.total} new ${digest.total === 1 ? 'item' : 'items'}`
                  : ''}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 -mr-1.5 text-muted hover:text-ink transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 sm:px-8 pb-8">
          {/* The signup comes before the list, not after it. A reader who wants
              the digest should not have to scroll a day's worth of arrivals to
              find the box, and on a heavy day the foot of this window is a long
              way down. It is boxed rather than ruled off so that sitting above
              the sections it reads as an offer beside the list, not as the first
              section of it. */}
          <EmailSignup />

          {loading && !digest && (
            <p className="py-10 text-center font-sans text-[13px] text-muted">Loading…</p>
          )}

          {digest && !sections.length && !loading && (
            <p className="py-10 font-serif text-[16px] text-ink-soft">
              Nothing has landed yet today. The daily run finishes shortly after 06:00 UTC.
            </p>
          )}

          {sections.map(section => <Section key={section.key} section={section} />)}
        </div>
      </div>
    </div>
  )
}
