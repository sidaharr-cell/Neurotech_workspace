import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, Cpu, ShieldCheck, FileText, FlaskConical, GitBranch,
} from 'lucide-react'
import { getDeviceById, getDeviceGraph } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { cardBadges, ACCESS_LABEL, isClosedLoop } from '../lib/facets'
import { StarButton } from '../components/Watch'

const yearOf = d => (d ? String(d).slice(0, 4) : '')
const fmtDate = ts => { if (!ts) return null; try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) } catch { return null } }

function Section({ icon: Icon, title, note, children }) {
  return (
    <section className="border-t border-rule pt-7 mt-9">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="flex items-center gap-2.5 font-serif text-[1.4rem] font-semibold text-ink tracking-[-0.01em]">
          <Icon className="w-[18px] h-[18px] text-accent shrink-0" strokeWidth={1.75} /> {title}
        </h2>
        {note && <span className="text-[12.5px] font-sans text-muted whitespace-nowrap">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Prov({ source, via, updated }) {
  const bits = []
  if (source) bits.push(`Source: ${source}`)
  if (via) bits.push(via)
  if (updated) bits.push(`updated ${fmtDate(updated)}`)
  if (!bits.length) return null
  return <p className="mt-4 text-[11.5px] font-sans text-muted/90">{bits.join(' · ')}</p>
}

// A labeled fact, omitted entirely when the value is unknown (never fabricated).
function Fact({ label, children }) {
  if (!children) return null
  return (
    <div>
      <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.09em] text-muted mb-0.5">{label}</div>
      <div className="text-[15px] text-ink font-body leading-snug">{children}</div>
    </div>
  )
}

const EVENT_ICON = { Regulatory: ShieldCheck, Paper: FileText, Trial: FlaskConical }

export default function DevicePage() {
  const { id } = useParams()
  const [device, setDevice] = useState(null)
  const [graph, setGraph] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setGraph(null)
    getDeviceById(id).then(d => {
      if (!alive) return
      setDevice(d); setLoading(false)
      if (d) getDeviceGraph(id).then(g => alive && setGraph(g))
    })
    return () => { alive = false }
  }, [id])

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12"><Loader /></div>
  if (!device) return <div className="max-w-3xl mx-auto px-4 py-16"><EmptyState icon={Cpu} title="Device not found">This device isn’t in the index.</EmptyState></div>

  const badges = cardBadges(device, 6)
  const fn = device.facet_function || []
  const ax = device.facet_access || []
  const direction = isClosedLoop(fn) ? 'Closed-loop' : fn.includes('records') ? 'Recording' : fn.includes('stimulates') ? 'Stimulation' : null
  const invasiveness = ax.map(a => ACCESS_LABEL[a]).filter(Boolean).join(', ') || null

  // Lineage: dated events from linked records, oldest first. Papers/trials are
  // empty until those edges are derived; regulatory events populate now.
  const g = graph
  const events = g ? [
    ...g.regulatory.map(r => ({ key: r.id, year: yearOf(r.decision_date), date: r.decision_date, type: 'Regulatory', label: `${r.pathway || 'FDA'}${r.number ? ` · ${r.number}` : ''} decision`, href: r.source_url })),
    ...g.papers.map(p => ({ key: p.id, year: yearOf(p.year), date: p.year, type: 'Paper', label: p.title, href: p.url })),
    ...g.trials.map(t => ({ key: t.id, year: yearOf(t.published_at), date: t.published_at, type: 'Trial', label: t.title, href: t.url })),
  ].filter(e => e.year).sort((a, b) => a.year.localeCompare(b.year)) : []

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/devices" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Devices
      </Link>

      {/* Header — badges and the watch action share the top row; the name spans
          full width below so it never wraps into a thin column. */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Kicker>Device</Kicker>
          {badges.map(b => (
            <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
          ))}
        </div>
        <div className="shrink-0"><StarButton item={{ type: 'devices', id: device.id, label: device.name, to: `/device/${device.id}` }} /></div>
      </div>
      <h1 className="font-serif text-3xl sm:text-[2.3rem] leading-[1.12] font-semibold text-ink tracking-[-0.015em]">{device.name}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted font-sans">
        {device.manufacturer && <span>{device.manufacturer}</span>}
        {device.status && <><span aria-hidden>·</span><span>{device.status}</span></>}
        {device.year && <><span aria-hidden>·</span><span>{device.year}</span></>}
        {device.url && <><span aria-hidden>·</span>
          <a href={device.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:text-accent transition-colors">FDA record<ExternalLink className="w-3 h-3" /></a>
        </>}
      </div>

      {/* Facts panel */}
      <Section icon={Cpu} title="Device facts">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
          <Fact label="Maker">
            {!g ? null : g.maker
              ? <Link to={`/company/${g.maker.id}`} className="text-accent hover:underline">{g.maker.name}</Link>
              : (device.manufacturer || null)}
          </Fact>
          <Fact label="Type">{device.type}</Fact>
          <Fact label="Invasiveness">{invasiveness}</Fact>
          <Fact label="Signal direction">{direction}</Fact>
          <Fact label="Signal type">{device.signal_type}</Fact>
          <Fact label="Channels">{device.channels}</Fact>
          <Fact label="FDA product code">{device.product_code}</Fact>
        </div>
        {device.description && <p className="mt-5 text-[15px] leading-relaxed text-ink-soft font-body">{device.description}</p>}
        <Prov source={device.source || 'openFDA'} updated={device.last_updated} />
      </Section>

      {/* Lineage timeline */}
      <Section icon={GitBranch} title="Lineage" note={events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : null}>
        {!g ? <Loader /> : events.length === 0
          ? <p className="text-[14px] text-muted font-body">No dated events are linked to this device yet.</p>
          : <>
              <ol className="relative border-l border-rule ml-2">
                {events.map(e => {
                  const Icon = EVENT_ICON[e.type] || GitBranch
                  const inner = (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12px] font-mono text-muted tabular-nums">{e.year}</span>
                        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.07em] text-accent">{e.type}</span>
                      </div>
                      <div className="mt-0.5 font-serif text-[1.02rem] leading-snug text-ink group-hover:text-accent">{e.label}</div>
                    </>
                  )
                  return (
                    <li key={e.key} className="relative pl-6 pb-5 last:pb-0">
                      <span className="absolute -left-[7px] top-1 grid place-items-center w-3.5 h-3.5 rounded-full bg-paper border border-accent">
                        <Icon className="w-2 h-2 text-accent" strokeWidth={2.5} />
                      </span>
                      {e.href
                        ? <a href={e.href} target="_blank" rel="noopener noreferrer" className="group block">{inner}</a>
                        : <div>{inner}</div>}
                    </li>
                  )
                })}
              </ol>
              <Prov source="openFDA, ClinicalTrials.gov, PubMed" updated={g.provenance.regulatory} />
            </>}
      </Section>

      {/* Related work */}
      <Section icon={FileText} title="Related work" note={g && g.relatedWork.length ? `${g.relatedWork.length}` : null}>
        {!g ? <Loader /> : g.relatedWork.length === 0
          ? <p className="text-[14px] text-muted font-body">No replication or contradiction links to the evaluating literature yet. These appear once paper-to-device and paper-to-paper links are derived.</p>
          : <div className="divide-y divide-rule">
              {g.relatedWork.map(p => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="group block py-2.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.07em] text-accent">{p.relation}</span>
                    {p.year && <span className="text-[12px] font-mono text-muted">{p.year}</span>}
                  </div>
                  <div className="font-serif text-[1.02rem] leading-snug text-ink group-hover:text-accent">{p.title}</div>
                </a>
              ))}
            </div>}
      </Section>

      {/* Page provenance */}
      <footer className="border-t-2 border-ink mt-12 pt-4 text-[12px] font-sans text-muted leading-relaxed">
        <span className="font-semibold text-ink-soft">Sources: </span>openFDA{g?.papers.length ? ', PubMed' : ''}{g?.trials.length ? ', ClinicalTrials.gov' : ''}.
        {' '}The maker, regulatory record, and lineage are assembled from typed relationships in the index, not name guesses.
      </footer>
    </article>
  )
}
