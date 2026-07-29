import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, Building2, MapPin, Calendar, Banknote,
  Cpu, FlaskConical, FileText, Newspaper, Briefcase,
  ShieldCheck, AlertTriangle, Users,
} from 'lucide-react'
import { getCompanyById, getCompanyRelated, getCompanyAnalytics, getOrgGraph, getPatentYears } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { cardBadges } from '../lib/facets'
import { fmtMonthYear, unavailableLabel } from '../lib/fundingBoard'
import { StarButton } from '../components/Watch'

const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)
const yearOf = d => (d ? String(d).slice(0, 4) : '')
const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const fmtDate = ts => { if (!ts) return null; try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) } catch { return null } }
const monthYear = ts => { if (!ts) return null; try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) } catch { return null } }

// Long linked lists (a big maker can have dozens) are capped for readability
// and to keep the page light; the section header still shows the true total.
const LIST_CAP = 15
const MoreNote = ({ n, of }) => (
  <p className="pt-3 text-[13px] font-sans text-muted">{n} more {of} linked. Full lists open at the source.</p>
)

/** Section shell: icon + serif title + optional right-side note, then children. */
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

/**
 * Per-section provenance line: where the section's facts come from and how fresh
 * they are. `via` is an optional plain-language note on how records were linked;
 * internal edge names (made_by, cleared_via, ...) are never shown to the reader.
 */
function Prov({ source, via, updated }) {
  const bits = []
  if (source) bits.push(`Source: ${source}`)
  if (via) bits.push(via)
  if (updated) bits.push(`updated ${fmtDate(updated)}`)
  if (!bits.length) return null
  return <p className="mt-4 text-[11.5px] font-sans text-muted/90">{bits.join(' · ')}</p>
}

/** A subsection inside the Business block. */
function BizSub({ title, note, children }) {
  return (
    <div className="border-t border-rule pt-5 mt-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="font-serif text-[1.15rem] font-semibold text-ink">{title}</h3>
        {note && <span className="text-[12px] font-sans text-muted whitespace-nowrap">{note}</span>}
      </div>
      {children}
    </div>
  )
}

/** Confidence-graded provenance for a business record (EDGAR/USPTO = higher). */
function BizProv({ confidence, text }) {
  return (
    <p className="mt-3 text-[11.5px] font-sans text-muted/90">
      <span className={`font-semibold ${confidence === 'high' ? 'text-ink-soft' : 'text-muted'}`}>{confidence === 'high' ? 'Higher confidence' : 'Lower confidence'}</span> · {text}
    </p>
  )
}

/** Funding raised per calendar year, from dated rounds. */
function FundingTimeline({ rounds }) {
  const byYear = {}
  for (const r of rounds || []) { const y = yearOf(r.date); if (y) byYear[y] = (byYear[y] || 0) + (r.amount || 0) }
  const years = Object.keys(byYear).sort()
  if (!years.length) return null
  const lo = +years[0], hi = +years[years.length - 1]
  const span = []
  for (let y = lo; y <= hi; y++) span.push(String(y))
  const max = Math.max(...Object.values(byYear), 1)
  const PLOT = 128 // px height of the bar area (value labels sit above the tallest bar)

  return (
    <figure className="mt-5 max-w-lg">
      <figcaption className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-4">Capital raised per year</figcaption>
      <div className="flex items-end justify-center gap-3" style={{ height: PLOT }}>
        {span.map(y => {
          const v = byYear[y] || 0
          const h = v > 0 ? Math.max((v / max) * PLOT, 8) : 0
          return (
            <div key={y} className="group relative flex-1 max-w-[46px] flex flex-col items-center justify-end h-full">
              {v > 0 && (
                <span className="mb-1.5 text-[10.5px] font-mono font-medium text-ink-soft whitespace-nowrap tabular-nums leading-none">{fmtMoney(v)}</span>
              )}
              {v > 0
                ? <div className="w-full rounded-t-[3px] bg-accent transition-[filter] duration-200 group-hover:brightness-110"
                    style={{ height: h }} title={`${y}: ${fmtMoney(v)}`} />
                : <span className="w-1 h-1 rounded-full bg-rule" title={`${y}: no raise on record`} />}
            </div>
          )
        })}
      </div>
      <div className="flex justify-center gap-3 border-t border-rule pt-2">
        {span.map(y => (
          <span key={y} className="flex-1 max-w-[46px] text-center text-[10.5px] font-mono text-muted tabular-nums">{`’${y.slice(2)}`}</span>
        ))}
      </div>
    </figure>
  )
}

/**
 * Regulatory-and-patent activity by year, overlaid so the trends are comparable.
 * Two line series (devices cleared, patents granted) over a shared year axis.
 * Each series is scaled to its own peak (noted in the legend) because patents and
 * clearances differ by orders of magnitude; this keeps both trends legible.
 * Business-layer only; never feeds any research ranking.
 */
function BusinessActivityChart({ deviceYears, patentYears }) {
  const years = [...new Set([...Object.keys(deviceYears), ...Object.keys(patentYears)])].map(Number).filter(y => y >= 1980 && y <= 2100)
  if (years.length < 2) return null
  const lo = Math.min(...years), hi = Math.max(...years)
  const span = []; for (let y = lo; y <= hi; y++) span.push(y)
  const dMax = Math.max(1, ...Object.values(deviceYears))
  const pMax = Math.max(1, ...Object.values(patentYears))
  const hasD = Object.keys(deviceYears).length > 0, hasP = Object.keys(patentYears).length > 0
  const W = 300, H = 90, PAD = 6
  const px = y => hi > lo ? PAD + ((y - lo) / (hi - lo)) * (W - 2 * PAD) : W / 2
  const py = (v, max) => (H - PAD) - (v / max) * (H - 2 * PAD)
  const pts = (map, max) => span.map(y => `${px(y).toFixed(1)},${py(map[y] || 0, max).toFixed(1)}`).join(' ')
  const PATENT = '#64748b'

  return (
    <figure className="mt-5">
      <figcaption className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2.5">Regulatory and patent activity by year</figcaption>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-[11.5px] font-sans text-ink-soft">
        {hasD && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-[2px] bg-accent" />Devices cleared <span className="text-muted">(peak {dMax}/yr)</span></span>}
        {hasP && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-[2px]" style={{ background: PATENT }} />Patents granted <span className="text-muted">(peak {pMax}/yr)</span></span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Devices cleared and patents granted per year">
        {hasP && <polyline fill="none" stroke={PATENT} strokeWidth="1" points={pts(patentYears, pMax)} />}
        {hasD && <polyline fill="none" stroke="#0B5FA6" strokeWidth="1" points={pts(deviceYears, dMax)} />}
        {hasP && span.filter(y => patentYears[y]).map(y => <circle key={`p${y}`} cx={px(y)} cy={py(patentYears[y], pMax)} r="1.6" fill={PATENT}><title>{`${y}: ${patentYears[y]} patents`}</title></circle>)}
        {hasD && span.filter(y => deviceYears[y]).map(y => <circle key={`d${y}`} cx={px(y)} cy={py(deviceYears[y], dMax)} r="1.6" fill="#0B5FA6"><title>{`${y}: ${deviceYears[y]} devices`}</title></circle>)}
      </svg>
      <div className="flex justify-between text-[10.5px] font-mono text-muted mt-1"><span>{lo}</span><span>{hi}</span></div>
      <p className="mt-2 text-[11px] text-muted font-sans">Each series is scaled to its own peak (shown in the legend) so the shapes are comparable across very different magnitudes.</p>
    </figure>
  )
}

const RowLink = ({ href, children }) => (
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="group block py-2.5 hover:text-accent transition-colors">{children}</a>
    : <div className="py-2.5">{children}</div>
)

export default function CompanyPage() {
  const { id } = useParams()
  const [company, setCompany] = useState(null)
  const [related, setRelated] = useState(null)
  const [graph, setGraph] = useState(null) // null = loading, then the getOrgGraph result
  const [analytics, setAnalytics] = useState(undefined) // undefined = loading, null = indexed/none
  const [patentYears, setPatentYears] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setRelated(null); setGraph(null); setAnalytics(undefined); setPatentYears({})
    getCompanyById(id).then(async c => {
      if (!alive) return
      setCompany(c); setLoading(false)
      if (c) {
        getOrgGraph(id).then(g => alive && setGraph(g))
        getCompanyRelated(c.name).then(r => alive && setRelated(r))
        getCompanyAnalytics(id).then(a => alive && setAnalytics(a))
        getPatentYears(c.name).then(p => alive && setPatentYears(p))
      }
    })
    return () => { alive = false }
  }, [id])

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12"><Loader /></div>
  if (!company) return <div className="max-w-3xl mx-auto px-4 py-16"><EmptyState icon={Building2} title="Company not found">This company isn’t in the index.</EmptyState></div>

  const labels = cardBadges(company, 6)
  const pubs = analytics?.publications
  const careersUrl = `https://www.google.com/search?q=${encodeURIComponent(`${company.name} careers jobs`)}`
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(company.name + ' neurotech')}`
  const ctgovUrl = `https://clinicaltrials.gov/search?spons=${encodeURIComponent(company.name)}`
  const maudeUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfMAUDE/TextSearch.cfm`
  // The graph sections (devices / trials / regulatory / people) come from the
  // relationships edge table. `graph` is null while loading.
  const g = graph
  const trialCount = g ? g.trials.active.length + g.trials.completed.length : 0
  // FDA devices cleared per year, from the graph, for the Business activity chart.
  const deviceYears = {}
  for (const d of g?.devices || []) { const y = yearOf(d.year); if (/^\d{4}$/.test(y)) deviceYears[y] = (deviceYears[y] || 0) + 1 }
  const founders = Array.isArray(company.founders) ? company.founders.filter(Boolean) : []
  // Sources feeding the whole page, for the page-level provenance footer.
  const pageSources = ['ClinicalTrials.gov', 'openFDA']
  if (pubs?.items?.length) pageSources.unshift('PubMed')
  if (company.fundingRounds?.length) pageSources.push('SEC EDGAR')
  const pageUpdated = g ? [g.provenance.devices, g.provenance.trials, g.provenance.regulatory].filter(Boolean).sort()[0] : null

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-muted hover:text-accent transition-colors mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Companies
      </Link>

      {/* Header — badges and the watch action share the top row; the name spans
          full width below so it never wraps into a thin column. */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Kicker>Company</Kicker>
          {labels.map(b => (
            <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
          ))}
        </div>
        <div className="shrink-0"><StarButton item={{ type: 'organizations', id: company.id, label: company.name, to: `/company/${company.id}` }} /></div>
      </div>
      <h1 className="font-serif text-3xl sm:text-[2.5rem] leading-[1.1] font-semibold text-ink tracking-[-0.015em]">{company.name}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted font-sans">
        {company.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{company.location}</span>}
        {company.founded && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Founded {company.founded}</span></>}
        {company.funding > 0 && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1 text-accent font-medium"><Banknote className="w-3.5 h-3.5" />{fmtMoney(company.funding)} raised</span></>}
        {company.website && <><span aria-hidden>·</span>
          <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:text-accent transition-colors">{host(company.website)}<ExternalLink className="w-3 h-3" /></a>
        </>}
        <span aria-hidden>·</span>
        <a href={ctgovUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink hover:text-accent transition-colors">ClinicalTrials.gov<ExternalLink className="w-3 h-3" /></a>
      </div>

      {/* A real, curated representative photo, shown responsively when one is on
          record. Populated by curation only; never auto-scraped (see migration 007). */}
      {company.image_url && (
        <figure className="mt-6">
          <img src={company.image_url} alt={`${company.name}`} loading="lazy"
            className="w-full h-auto max-h-80 object-cover rounded-sm border border-rule" />
        </figure>
      )}

      {company.description && <p className="mt-6 text-[1.12rem] leading-[1.7] text-ink font-body">{company.description}</p>}


      {/* Devices — made_by edge */}
      <Section icon={Cpu} title="Devices" note={g ? `${g.devices.length} linked` : null}>
        {!g ? <Loader /> : g.devices.length === 0
          ? <p className="text-[14px] text-muted font-body">No devices are linked to this organization yet. A device links here when its FDA maker name matches this organization.</p>
          : <>
              <div className="divide-y divide-rule">
                {g.devices.slice(0, LIST_CAP).map(d => (
                  <RowLink key={d.id} href={d.url}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-serif text-[1.05rem] text-ink group-hover:text-accent">{d.name}</span>
                      <span className="text-[12px] font-mono text-muted whitespace-nowrap">{d.status || d.type || ''}{d.year ? ` · ${d.year}` : ''}</span>
                    </div>
                  </RowLink>
                ))}
              </div>
              {g.devices.length > LIST_CAP && <MoreNote n={g.devices.length - LIST_CAP} of="devices" />}
              <Prov source="openFDA" updated={g.provenance.devices} />
            </>}
      </Section>

      {/* Regulatory — cleared_via edge on this org's devices, plus a MAUDE pointer */}
      <Section icon={ShieldCheck} title="Regulatory" note={g ? `${g.regulatory.length} record${g.regulatory.length === 1 ? '' : 's'}` : null}>
        {!g ? <Loader /> : (
          <>
            {g.regulatory.length === 0
              ? <p className="text-[14px] text-muted font-body">No FDA clearance or approval records are linked yet.</p>
              : <>
                  <div className="divide-y divide-rule">
                    {g.regulatory.slice(0, LIST_CAP).map(r => (
                      <RowLink key={r.id} href={r.source_url}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-serif text-[1.05rem] text-ink group-hover:text-accent">{r.pathway || 'FDA record'}{r.number ? ` · ${r.number}` : ''}</span>
                          <span className="text-[12px] font-mono text-muted whitespace-nowrap">{yearOf(r.decision_date)}</span>
                        </div>
                        {r.device_name && <div className="mt-0.5 text-[12px] font-sans text-muted">{r.device_name}</div>}
                      </RowLink>
                    ))}
                  </div>
                  {g.regulatory.length > LIST_CAP && <MoreNote n={g.regulatory.length - LIST_CAP} of="records" />}
                  <Prov source="openFDA" updated={g.provenance.regulatory} />
                </>}

            {/* MAUDE — self-reported adverse-event reports. Not yet indexed; a
                sourced pointer and a count, never a safety judgment. */}
            <div className="mt-6 border-t border-dashed border-rule pt-4">
              <div className="flex items-center gap-2 text-[13px] font-sans font-semibold text-ink-soft mb-1.5">
                <AlertTriangle className="w-4 h-4 text-muted" strokeWidth={1.75} /> Adverse-event reports (MAUDE)
              </div>
              <p className="text-[13px] text-muted font-body max-w-prose">
                MAUDE reports are self-reported and noisy. NeuroBase does not yet index them, and never presents them as an outcome or a safety judgment. Query the FDA MAUDE database directly for this maker's devices.
              </p>
              <a href={maudeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-[13px] font-sans text-accent hover:underline">
                Search FDA MAUDE <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
      </Section>

      {/* Clinical trials — sponsored_by edge, active separated from completed */}
      <Section icon={FlaskConical} title="Clinical trials" note={g ? `${trialCount} linked` : null}>
        {!g ? <Loader /> : trialCount === 0
          ? <p className="text-[14px] text-muted font-body">No clinical trials are linked to this sponsor yet.</p>
          : <>
              {['active', 'completed'].map(bucket => g.trials[bucket].length > 0 && (
                <div key={bucket} className="mb-5 last:mb-0">
                  <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-muted mb-2">{bucket === 'active' ? 'Active' : 'Completed and other'}</div>
                  <div className="divide-y divide-rule">
                    {g.trials[bucket].map(t => {
                      const m = t.metadata || {}
                      return (
                        <RowLink key={t.id} href={t.url}>
                          <div className="font-serif text-[1.05rem] text-ink leading-snug group-hover:text-accent">{t.title}</div>
                          <div className="mt-1 flex flex-wrap gap-x-2 text-[12px] font-mono text-muted">
                            {m.phase && <span>{m.phase}</span>}
                            {m.status && <span>· {m.status}</span>}
                            {m.enrollment ? <span>· n={m.enrollment}</span> : null}
                            {m.nctId && <span>· {m.nctId}</span>}
                          </div>
                        </RowLink>
                      )
                    })}
                  </div>
                </div>
              ))}
              <Prov source="ClinicalTrials.gov" updated={g.provenance.trials} />
            </>}
      </Section>

      {/* Publications */}
      <Section icon={FileText} title="Publications" note={pubs?.total ? `${pubs.total} official` : null}>
        {analytics === undefined ? <Loader />
          : !pubs || pubs.items.length === 0
            ? <div>
                <p className="text-[14px] text-muted font-body mb-3">No official company publications identified on PubMed.</p>
                <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`"${company.name}"[Affiliation]`)}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-sans text-accent hover:underline">Search PubMed <ExternalLink className="w-3.5 h-3.5" /></a>
              </div>
            : <div className="divide-y divide-rule">
                {pubs.items.map(p => (
                  <RowLink key={p.pmid} href={p.url}>
                    <div className="font-serif text-[1.05rem] text-ink leading-snug group-hover:text-accent">{p.title}</div>
                    <div className="mt-1 text-[12px] font-sans text-muted italic">{[p.journal, p.year].filter(Boolean).join(' · ')}</div>
                  </RowLink>
                ))}
                <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`"${company.name}"[Affiliation]`)}`} target="_blank" rel="noopener noreferrer"
                  className="inline-block pt-3 text-[13px] font-sans text-accent hover:underline">Search all on PubMed →</a>
              </div>}
        {pubs?.items?.length ? <Prov source="PubMed" via="matched by author affiliation" /> : null}
      </Section>

      {/* People — leadership (founders on record) and affiliated researchers */}
      <Section icon={Users} title="People" note={founders.length ? `${founders.length} on record` : null}>
        {founders.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.09em] text-muted mb-1.5">Founders and leadership</div>
            <div className="divide-y divide-rule">
              {founders.map((f, i) => (
                <div key={i} className="py-2.5 font-serif text-[1.05rem] text-ink">{f}</div>
              ))}
            </div>
          </div>
        )}
        {g && g.people.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] font-sans font-semibold uppercase tracking-[0.09em] text-muted mb-1.5">Affiliated researchers</div>
            <div className="divide-y divide-rule">
              {g.people.map(p => (
                <div key={p.id} className="py-2.5 flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[1.05rem] text-ink">{p.name}</span>
                  {p.role && <span className="text-[12px] font-sans text-muted whitespace-nowrap">{p.role}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {founders.length === 0 && (!g || g.people.length === 0) && (
          <p className="text-[14px] text-muted font-body">No people are on record for this organization. A full leadership roster (CEO, COO, and similar) needs a disclosed-announcement source, which NeuroBase does not yet index. It never comes from LinkedIn.</p>
        )}
      </Section>

      {/* Press / news */}
      <Section icon={Newspaper} title="In the news">
        {related?.news?.length > 0 && (
          <div className="divide-y divide-rule mb-3">
            {related.news.map(n => (
              <RowLink key={n.id} href={n.url}>
                <div className="font-serif text-[1.05rem] text-ink leading-snug group-hover:text-accent">{n.title}</div>
                <div className="mt-1 text-[12px] font-sans text-muted">{[n.source, monthYear(n.published_at)].filter(Boolean).join(' · ')}</div>
              </RowLink>
            ))}
          </div>
        )}
        <a href={newsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-accent hover:underline">
          Latest press and news on Google News <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </Section>

      {/* ── Business and market context (Phase 10) ──────────────────────────
          A separate, plainly-labeled layer. Sourced differently from the
          research dossier above, at varying confidence, and never used in any
          ranking, the Feed, or the research facets. No valuations are inferred
          and no investment guidance is given. */}
      <section className="mt-14 border-2 border-rule rounded-sm bg-canvas/60 p-5 sm:p-7">
        <div className="flex items-center gap-2.5">
          <Briefcase className="w-[18px] h-[18px] text-ink-soft shrink-0" strokeWidth={1.75} />
          <h2 className="font-serif text-[1.4rem] font-semibold text-ink tracking-[-0.01em]">Business and market context</h2>
        </div>
        <p className="mt-2 mb-2 text-[12.5px] text-muted font-sans leading-relaxed max-w-prose">
          Sourced separately from the research dossier above, from SEC EDGAR, USPTO, and disclosed announcements, at varying confidence. These figures never affect any research ranking, the feed, or the research facets. No valuations are inferred and no investment guidance is given.
        </p>

        {/* Funding — SEC EDGAR Form D filings, read from the organizations table.
            Form D does not name a round, so the note carries the amount and the
            month rather than a label like "Series C" that no filing supports. */}
        <BizSub title="Funding" note={company.latestRaise
          ? `Latest: ${fmtMoney(company.latestRaise)}${company.latestRaiseDate ? ` · ${fmtMonthYear(company.latestRaiseDate)}` : ''}`
          : (company.funding > 0 ? `Latest: ${(unavailableLabel({
              status: company.status, unavailableReason: company.fundingUnavailableReason,
            }).short)}` : null)}>
          {(company.funding > 0 || company.fundingRounds?.length > 0) ? (
            <>
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                <div>
                  <div className="font-serif text-3xl font-semibold text-ink">{company.funding > 0 ? fmtMoney(company.funding) : 'Undisclosed'}</div>
                  <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5">Total disclosed</div>
                </div>
                {company.fundingRounds?.length > 0 && (
                  <div>
                    <div className="font-serif text-3xl font-semibold text-ink">{company.fundingRounds.length}</div>
                    <div className="text-[12px] font-sans uppercase tracking-[0.08em] text-muted mt-0.5">Rounds on record</div>
                  </div>
                )}
              </div>
              <FundingTimeline rounds={company.fundingRounds} />
              <BizProv confidence={company.fundingSource === 'sec' ? 'high' : 'low'}
                text={company.fundingSource === 'sec'
                  ? 'SEC EDGAR Form D filings. Private capital only, so a figure for a company that has since listed or been acquired excludes what it raised afterwards. Undisclosed amounts are shown as undisclosed; none are estimated.'
                  : 'Not traceable to an SEC filing. Lower confidence; no amount is estimated.'} />
              {company.fundingSourceUrl && (
                <p className="text-[12px] font-sans text-muted mt-1">
                  <a href={company.fundingSourceUrl} target="_blank" rel="noreferrer"
                    className="text-accent hover:underline">Filing this figure was read from</a>
                </p>
              )}
            </>
          ) : <p className="text-[14px] text-muted font-body">No disclosed funding on record.</p>}
          <BusinessActivityChart deviceYears={deviceYears} patentYears={patentYears} />
        </BizSub>

        {/* Mergers and acquisitions — no open structured feed exists; empty by design */}
        <BizSub title="Mergers and acquisitions">
          <p className="text-[14px] text-muted font-body">No acquisition or merger events are recorded. There is no open structured feed for deals; each would be modeled as an event tied to a primary announcement, corroborated by an SEC 8-K for public acquirers. Nothing is inferred.</p>
        </BizSub>

        {/* Patents — USPTO, matched by assignee name */}
        <BizSub title="Patents" note={related ? `${related.patentCount.toLocaleString()} assigned` : null}>
          {!related ? <Loader /> : related.patents.length === 0
            ? <p className="text-[14px] text-muted font-body">No patents matched to this assignee in the index.</p>
            : <>
                <div className="divide-y divide-rule">
                  {related.patents.map(p => (
                    <RowLink key={p.patent_number} href={p.url}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-serif text-[1.05rem] text-ink leading-snug group-hover:text-accent">{p.title}</span>
                        <span className="text-[12px] font-mono text-muted whitespace-nowrap">{yearOf(p.grant_date)}</span>
                      </div>
                    </RowLink>
                  ))}
                </div>
                <BizProv confidence="high" text="USPTO, matched to this assignee by name. Not linked to specific devices unless the mapping is confident." />
              </>}
        </BizSub>

        {/* Talent — link to the company's own careers page; never LinkedIn */}
        <BizSub title="Talent">
          <p className="text-[14px] text-muted font-body mb-3">Open roles are listed on the company's own careers page. NeuroBase does not scrape individual postings or use LinkedIn or any source that prohibits it; it links you to the source instead.</p>
          <div className="flex flex-wrap gap-3">
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3.5 py-1.5 rounded-full border border-rule text-ink-soft hover:border-ink transition-colors">
                Company site <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <a href={careersUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3.5 py-1.5 rounded-full border border-rule text-ink-soft hover:border-ink transition-colors">
              Careers and open roles <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </BizSub>
      </section>

      {/* Page-level provenance: what fed this dossier and how fresh it is. */}
      <footer className="border-t-2 border-ink mt-12 pt-4 text-[12px] font-sans text-muted leading-relaxed">
        <span className="font-semibold text-ink-soft">Sources: </span>{pageSources.join(', ')}.
        {pageUpdated && <> Oldest linked record updated {fmtDate(pageUpdated)}.</>} Devices, regulatory records, and trials are assembled from typed relationships in the index, not name guesses. Funding and patents are business context, shown separately and never used in any research ranking.
      </footer>
    </article>
  )
}
