import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ExternalLink, Newspaper, TrendingUp, Sparkles } from 'lucide-react'
import { getNewsFeed } from '../lib/data'
import { supabase } from '../lib/supabase'
import { NeuralBackground, LiveBadge, ScoreDot, Loader, EmptyState } from '../components/ui'
import TopicBar from '../components/TopicBar'
import { entityMatchesTopic } from '../lib/taxonomy'

import papersJson from '../data/papers.json'
import devicesJson from '../data/devices.json'
import organizationsJson from '../data/organizations.json'
import researchersJson from '../data/researchers.json'

const TYPE_BADGE = {
  paper: 'text-cyan border-cyan/30 bg-cyan/10',
  preprint: 'text-primary-light border-primary/30 bg-primary/10',
  news: 'text-rose-300 border-rose-400/30 bg-rose-400/10',
}

function FeedCard({ item }) {
  // Publication date, formatted in UTC so the calendar day matches what was stored.
  const date = item.published_at
    ? new Date(item.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ''
  const badge = TYPE_BADGE[item.entry_type] || TYPE_BADGE.news
  const label = item.entry_type === 'preprint' ? 'Preprint' : item.entry_type === 'paper' ? 'Paper' : 'News'
  const cites = item.metadata?.citationCount ?? 0
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="group flex flex-col glass rounded-2xl p-5 card-hover">
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${badge}`}>{label}</span>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreDot score={item.relevance_score} />
          <ExternalLink className="w-3.5 h-3.5 text-muted/40 group-hover:text-primary-light transition-colors" />
        </div>
      </div>
      <h3 className="font-display font-semibold text-sm text-ink leading-snug line-clamp-3 mb-2 group-hover:text-primary-light transition-colors">{item.title}</h3>
      {item.summary && (
        <p className="text-xs text-muted line-clamp-3 mb-3 leading-relaxed">
          <Sparkles className="inline w-3 h-3 text-primary-light mr-1 -mt-0.5" />
          {item.summary}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-auto pt-2">
        <span className="text-xs text-muted truncate">
          {item.source}
          {cites > 0 && <span className="text-mint"> · {cites.toLocaleString()} citation{cites === 1 ? '' : 's'}</span>}
        </span>
        {date && <span className="text-[10px] font-mono text-muted/60 shrink-0">{date}</span>}
      </div>
      {item.topics?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {item.topics.slice(0, 3).map(t => (
            <span key={t} className="text-[10px] font-mono bg-primary/8 text-primary-light px-2 py-0.5 rounded">{t}</span>
          ))}
        </div>
      )}
    </a>
  )
}

function Hero() {
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const total = papersJson.length + devicesJson.length + organizationsJson.length + researchersJson.length

  const submit = (e) => { e.preventDefault(); navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search') }

  const stats = [
    { n: papersJson.length, l: 'Research' },
    { n: devicesJson.length, l: 'Devices' },
    { n: organizationsJson.length, l: 'Organizations' },
  ]

  return (
    <section className="relative overflow-hidden pt-20 pb-16">
      <NeuralBackground />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <div className="inline-flex items-center gap-2 glass text-primary-light text-xs font-mono px-3 py-1.5 rounded-full mb-8">
          <span className="w-1.5 h-1.5 bg-mint rounded-full animate-pulse-slow shadow-[0_0_8px_#34D399]" />
          {total}+ entries · auto-updating daily
        </div>
        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] mb-5">
          Neuro<span className="text-gradient">Base</span>
        </h1>
        <p className="text-muted text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-9">
          An open, AI-curated index of the research, devices, organizations, and clinical trials
          defining the field.
        </p>
        <form onSubmit={submit} className="relative max-w-2xl mx-auto mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search research, devices, organizations, trials…"
            className="w-full pl-12 pr-32 py-4 bg-surface/80 border border-divider rounded-2xl text-ink placeholder-muted/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all shadow-panel"
          />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:shadow-glow transition-shadow">
            Search
          </button>
        </form>
        <div className="flex items-center justify-center gap-8 text-sm">
          {stats.map(s => (
            <div key={s.l} className="flex items-baseline gap-1.5">
              <span className="font-display font-bold text-ink text-lg">{s.n}</span>
              <span className="text-muted">{s.l}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function Feed() {
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getNewsFeed({ limit: 48 })
    setFeed(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Weekly feed shows at most 10 items (after any topic filter).
  const filtered = useMemo(
    () => (topic ? feed.filter(i => entityMatchesTopic(i, topic)) : feed).slice(0, 10),
    [feed, topic]
  )

  return (
    <>
      <Hero />
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 border-t border-divider">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-primary-light" />
              <p className="font-mono text-xs text-primary-light uppercase tracking-[0.2em] font-semibold">Most significant · last 90 days</p>
            </div>
            <h2 className="font-display text-2xl font-bold text-ink">Ranked by relevance &amp; engagement</h2>
            <p className="text-muted text-sm mt-1">Blends AI relevance, citation impact, and recency — the summary explains why each matters.</p>
          </div>
          {supabase && <LiveBadge>Live · updates daily at 6am UTC</LiveBadge>}
        </div>

        <div className="mb-7">
          <TopicBar activeTopic={topic} onTopic={setTopic} />
        </div>

        {!supabase ? (
          <EmptyState icon={Newspaper} title="Feed unavailable in offline mode">Connect Supabase to see the live curated feed.</EmptyState>
        ) : loading ? (
          <Loader label="Loading feed…" />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Newspaper} title="Nothing here yet">
            {topic ? 'No feed items match this topic right now.' : 'The feed populates after the first daily refresh.'}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((item, i) => (
              <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}>
                <FeedCard item={item} />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
