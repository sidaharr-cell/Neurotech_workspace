import { useState, useRef, useEffect } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { ChevronDown, Search, Menu, X, Cog, Star, Sparkles } from 'lucide-react'
import { facetSearch } from '../lib/useUrlFacets'
import WhatsNewDialog from './WhatsNewDialog'

const TOPICS = [
  { to: '/trials', label: 'Clinical Trials' },
  { to: '/companies', label: 'Companies and Labs' },
  { to: '/devices', label: 'Devices and Patents' },
  { to: '/media', label: 'News & Press' },
  { to: '/research', label: 'Research' },
]

/**
 * Topic links carry whatever facets are set on the page you are leaving, so a
 * reader who narrows the front page to implanted BCIs and opens Trials stays
 * narrowed instead of arriving somewhere unfiltered with no sign their filter
 * was dropped.
 *
 * This menu is on every page, so the carry is not special-cased to the home
 * page: the facets mean the same thing on all six surfaces, and a filter that
 * survived one hop and silently died on the next would be worse than one that
 * never survived at all. A value with nothing behind it on the destination is
 * still shown as selected, with Clear all beside it — FilterBar never hides a
 * value that is chosen, precisely so a filter cannot be set with no way to
 * unset it.
 */
function useTopicLinks() {
  const { search } = useLocation()
  const carry = facetSearch(search)
  // Home carries too. It is a destination in this same nav row, and a filter
  // that survives every hop except the one back to the front page is a filter
  // the reader has to rebuild for no reason they could predict.
  return { carry, home: `/${carry}`, topics: TOPICS.map(t => ({ ...t, href: `${t.to}${carry}` })) }
}

// Wordmark: a gear replacing the "o" in NeuroBase (neuro + technology).
//
// 2.9rem is set against the page headings, not chosen on its own. The masthead
// has to outrank whatever heading sits under it, and every page title — the
// topic pages through SectionHeading, and Top Stories set to match them — is
// 2.5rem. A publication's name smaller than the name of one of its sections
// reads as a section that has escaped its paper. The gap has to be wide enough
// to see: at 2.6rem it outranked them by a pixel and a half, which is a rule
// obeyed in arithmetic and broken on the page.
function Wordmark({ size = 'lg' }) {
  const text = size === 'sm' ? 'text-xl' : 'text-3xl sm:text-[2.9rem]'
  const gear = size === 'sm' ? 'w-[0.68em] h-[0.68em]' : 'w-[0.72em] h-[0.72em]'
  return (
    <span className={`inline-flex items-center font-serif ${text} font-semibold tracking-[-0.02em] text-ink`}>
      Neur<Cog className={`${gear} mx-[0.02em] text-ink`} strokeWidth={2} aria-hidden="true" />Base
    </span>
  )
}

function useOutsideClose(ref, onClose) {
  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [ref, onClose])
}

function TopicsDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const loc = useLocation()
  const { topics } = useTopicLinks()
  useOutsideClose(ref, () => setOpen(false))
  useEffect(() => { setOpen(false) }, [loc.pathname])

  const active = TOPICS.some(t => loc.pathname.startsWith(t.to))

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 text-[13px] font-sans font-semibold uppercase tracking-[0.1em] py-3 transition-colors ${active ? 'text-accent' : 'text-ink hover:text-accent'}`}
        aria-expanded={open}
      >
        All Topics <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 w-64 bg-paper border border-rule shadow-lg rounded-sm py-1.5 animate-slide-down">
          {topics.map(t => (
            <NavLink
              key={t.to}
              to={t.href}
              className={({ isActive }) => `block px-4 py-2 font-serif text-[15px] text-ink hover:bg-canvas transition-colors ${isActive ? 'bg-canvas' : ''}`}
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function Masthead() {
  const [mobileOpen, setMobileOpen] = useState(false)
  // "What's new today?" is a window over the page rather than a route (see
  // WhatsNewDialog), so its open state lives here, beside the tab that opens it.
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const { pathname } = useLocation()
  const { topics, home } = useTopicLinks()
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // Following a link out of the window is leaving it: the story the reader
  // clicked is behind the panel, and a window that stayed open over it would
  // hide the thing it just sent them to.
  useEffect(() => { setWhatsNewOpen(false) }, [pathname])

  const navLink = ({ isActive }) =>
    `text-[13px] font-sans font-semibold uppercase tracking-[0.1em] py-3 transition-colors ${isActive ? 'text-accent' : 'text-ink hover:text-accent'}`

  return (
    <header className="border-b border-ink bg-paper">
      {/* Top row: date · wordmark · search */}
      <div className="page-wide">
        <div className="grid grid-cols-3 items-center py-4">
          <div className="hidden sm:block text-[12px] text-muted font-sans">{today}</div>
          {/* The wordmark stays uncarried while the nav's Home link carries.
              It is the masthead, so it goes to the front page plain, and that
              makes it the one gesture that drops a filter without hunting for
              Clear all. */}
          <Link to="/" className="col-span-2 sm:col-span-1 justify-self-start sm:justify-self-center">
            <Wordmark />
          </Link>
          <div className="justify-self-end hidden sm:flex items-center gap-5">
            <button
              type="button"
              onClick={() => setWhatsNewOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={whatsNewOpen}
              className="inline-flex items-center gap-1.5 text-[13px] font-sans text-ink-soft hover:text-accent transition-colors"
            >
              <Sparkles className="w-4 h-4" /> What&apos;s new today?
            </button>
            <Link to="/watchlist" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-ink-soft hover:text-accent transition-colors">
              <Star className="w-4 h-4" /> Watchlist
            </Link>
            <Link to="/search" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-ink-soft hover:text-accent transition-colors">
              <Search className="w-4 h-4" /> Search
            </Link>
          </div>
          <button className="justify-self-end sm:hidden p-1.5" onClick={() => setMobileOpen(o => !o)} aria-label="Menu">
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Nav bar (Search intentionally omitted — it lives top-right) */}
      <div className="border-t border-rule hidden sm:block">
        <nav className="page-wide flex items-center gap-7">
          <NavLink to={home} end className={navLink}>Home</NavLink>
          <TopicsDropdown />
        </nav>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-rule px-4 py-3 space-y-1">
          <MobileLink to={home} label="Home" onClick={() => setMobileOpen(false)} />
          {topics.map(t => <MobileLink key={t.to} to={t.href} label={t.label} onClick={() => setMobileOpen(false)} />)}
          <button
            type="button"
            onClick={() => { setMobileOpen(false); setWhatsNewOpen(true) }}
            aria-haspopup="dialog"
            className="block w-full text-left py-2 font-sans text-[14px] font-semibold uppercase tracking-[0.08em] text-ink"
          >
            What&apos;s new today?
          </button>
          <MobileLink to="/watchlist" label="Watchlist" onClick={() => setMobileOpen(false)} />
          <MobileLink to="/search" label="Search" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <WhatsNewDialog open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
    </header>
  )
}

function MobileLink({ to, label, onClick }) {
  return (
    <NavLink
      to={to}
      // Home now arrives here as '/' or '/?fn=…', and without `end` a bare '/'
      // prefix-matches every route, which lights Home up on all of them.
      end={to === '/' || to.startsWith('/?')}
      onClick={onClick}
      className={({ isActive }) => `block py-2 font-sans text-[14px] font-semibold uppercase tracking-[0.08em] ${isActive ? 'text-accent' : 'text-ink'}`}
    >
      {label}
    </NavLink>
  )
}

function Footer() {
  return (
    <footer className="border-t border-ink mt-16">
      <div className="page-wide py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Wordmark size="sm" />
          <p className="text-[12px] text-muted font-sans text-center">
            An open, AI-curated index of neurotechnology · Not affiliated with any institution
          </p>
        </div>
      </div>
    </footer>
  )
}

export default function Shell() {
  // Reset scroll to the top on every route change (otherwise navigating from
  // the bottom of one page lands partway down the next).
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="min-h-screen flex flex-col">
      <Masthead />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
