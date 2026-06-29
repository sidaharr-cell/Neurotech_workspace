import { useState, useEffect } from 'react'
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom'
import { BrainCircuit, Search, Menu, X } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Feed', end: true },
  { to: '/research', label: 'Research' },
  { to: '/devices', label: 'Devices' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/trials', label: 'Trials' },
]

function Logo({ size = 'base' }) {
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8'
  const icon = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5'
  return (
    <Link to="/" className="flex items-center gap-2.5 group shrink-0">
      <div className={`${dim} rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow group-hover:scale-105 transition-transform`}>
        <BrainCircuit className={`${icon} text-white`} strokeWidth={1.8} />
      </div>
      <span className="font-display font-bold text-ink text-[15px] tracking-tight">
        Neuro<span className="text-gradient">Base</span>
      </span>
    </Link>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  const submitSearch = (e) => {
    e.preventDefault()
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search')
    setMenuOpen(false)
  }

  const linkClass = ({ isActive }) =>
    `text-sm font-medium transition-colors ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`

  return (
    <nav className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${scrolled ? 'glass border-b border-divider' : 'bg-transparent border-b border-transparent'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          <Logo />

          <div className="hidden md:flex items-center gap-6">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
                {n.label}
              </NavLink>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <form onSubmit={submitSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                className="w-44 lg:w-56 pl-9 pr-3 py-2 text-sm bg-white/[0.04] border border-divider rounded-full text-ink placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:w-64 transition-all"
              />
            </form>
          </div>

          <button className="md:hidden p-2 rounded-lg hover:bg-white/5 transition-colors" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            {menuOpen ? <X className="w-5 h-5 text-ink" /> : <Menu className="w-5 h-5 text-ink" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden glass border-b border-divider px-4 pb-4 pt-2 space-y-1">
          <form onSubmit={submitSearch} className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-white/[0.04] border border-divider rounded-lg text-ink placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </form>
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `block py-2.5 px-3 text-sm font-medium rounded-lg transition-colors ${isActive ? 'bg-primary/15 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink'}`}
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  )
}

function Footer() {
  return (
    <footer className="border-t border-divider py-10 mt-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-5">
          <Logo size="sm" />
          <p className="text-xs text-muted text-center">
            An open research database for the neurotechnology community · Not affiliated with any institution
          </p>
          <div className="flex items-center gap-5 text-xs text-muted">
            <Link to="/research" className="hover:text-ink transition-colors">Research</Link>
            <Link to="/devices" className="hover:text-ink transition-colors">Devices</Link>
            <Link to="/trials" className="hover:text-ink transition-colors">Trials</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function Shell() {
  return (
    <div className="min-h-screen bg-background font-body flex flex-col">
      <Nav />
      <main className="flex-1 pt-16">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
