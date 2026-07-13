import { useState, useRef, useEffect } from 'react'
import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, Search, Menu, X, Cog } from 'lucide-react'
import { NeuronBackdrop } from './neuron'

const TOPICS = [
  { to: '/media', label: 'Media' },
  { to: '/research', label: 'Research' },
  { to: '/trials', label: 'Clinical Trials' },
  { to: '/companies', label: 'Companies' },
  { to: '/devices', label: 'Devices' },
]

// Wordmark: a gear replacing the "o" in NeuroBase (neuro + technology).
function Wordmark({ size = 'lg' }) {
  const text = size === 'sm' ? 'text-xl' : 'text-3xl sm:text-[2.1rem]'
  const gear = size === 'sm' ? 'w-[0.68em] h-[0.68em]' : 'w-[0.72em] h-[0.72em]'
  return (
    <span className={`inline-flex items-center font-serif ${text} font-semibold tracking-[-0.02em] text-ink`}>
      Neur<Cog className={`${gear} mx-[0.02em] text-accent`} strokeWidth={2} aria-hidden="true" />Base
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
          {TOPICS.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
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
  const navigate = useNavigate()
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const navLink = ({ isActive }) =>
    `text-[13px] font-sans font-semibold uppercase tracking-[0.1em] py-3 transition-colors ${isActive ? 'text-accent' : 'text-ink hover:text-accent'}`

  return (
    <header className="border-b border-ink bg-paper">
      {/* Top row: date · wordmark · search */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-3 items-center py-4">
          <div className="hidden sm:block text-[12px] text-muted font-sans">{today}</div>
          <Link to="/" className="col-span-2 sm:col-span-1 justify-self-start sm:justify-self-center">
            <Wordmark />
          </Link>
          <div className="justify-self-end hidden sm:flex">
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
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-7">
          <NavLink to="/" end className={navLink}>Home</NavLink>
          <TopicsDropdown />
        </nav>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-rule px-4 py-3 space-y-1">
          <MobileLink to="/" label="Home" onClick={() => setMobileOpen(false)} />
          {TOPICS.map(t => <MobileLink key={t.to} to={t.to} label={t.label} onClick={() => setMobileOpen(false)} />)}
          <MobileLink to="/search" label="Search" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </header>
  )
}

function MobileLink({ to, label, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Wordmark size="sm" />
          <p className="text-[12px] text-muted font-sans text-center">
            An open, AI-curated index of neurotechnology · Not affiliated with any institution
          </p>
          <div className="flex items-center gap-5 text-[12px] font-sans text-muted">
            <Link to="/research" className="hover:text-accent">Research</Link>
            <Link to="/devices" className="hover:text-accent">Devices</Link>
            <Link to="/search" className="hover:text-accent">Search</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function Shell() {
  return (
    <div className="min-h-screen flex flex-col">
      <NeuronBackdrop />
      <Masthead />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
