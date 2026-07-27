import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, Building2, MapPin, Calendar, Banknote,
  Cpu, FlaskConical, FileText, ScrollText, Newspaper, Briefcase,
  ShieldCheck, AlertTriangle, Users,
} from 'lucide-react'
import { getCompanyById, getCompanyRelated, getCompanyAnalytics, getOrgGraph } from '../lib/data'
import { Loader, EmptyState, Kicker } from '../components/ui'
import { cardBadges } from '../lib/facets'

const fmtMoney = m => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`)
const yearOf = d => (d ? String(d).slice(0, 4) : '')
const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const fmtDate = ts => { if (!ts) return null; try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) } catch { return null } }

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
 * they are. `via` names the graph edge that linked the records (so a reader can
 * see a section is assembled from real relationships, not a name match).
 */
function Prov({ source, via, updated }) {
  const bits = []
  if (source) bits.push(`Source: ${source}`)
  if (via) bits.push(`linked by ${via}`)
  if (updated) bits.push(`updated ${fmtDate(updated)}`)
  if (!bits.length) return null
  return <p className="mt-4 text-[11.5px] font-sans text-muted/90">{bits.join(' · ')}</p>
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
                ? <div className="w-full rounded-t-[3px] bg-gradient-to-t from-accent/55 to-accent transition-[filter] duration-200 group-hover:brightness-110"
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setRelated(null); setGraph(null); setAnalytics(undefined)
    getCompanyById(id).then(async c => {
      if (!alive) return
      setCompany(c); setLoading(false)
      if (c) {
        getOrgGraph(id).then(g => alive && setGraph(g))
        getCompanyRelated(c.name).then(r => alive && setRelated(r))
        getCompanyAnalytics(id).then(a => alive && setAnalytics(a))
      }
    })
    return () => { alive = false }
  }, [id])

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12"><Loader /></div>
  if (!company) return <div className="max-w-3xl mx-auto px-4 py-16"><EmptyState icon={Building2} title="Company not found">This company isn’t in the index.</EmptyState></div>

  const labels = cardBadges(company, 6)
  const pubs = analytics?.publications
  const jobsUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(company.name)}`
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(company.name + ' neurotech')}`
  const ctgovUrl = `https://clinicaltrials.gov/search?spons=${encodeURIComponent(company.name)}`
  const maudeUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfMAUDE/TextSearch.cfm`
  // The graph sections (devices / trials / regulatory / people) come from the
  // relationships edge table. `graph` is null while loading.
  const g = graph
  const trialCount = g ? g.trials.active.length + g.trials.completed.length : 0
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

      {/* Header */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Kicker>Company</Kicker>
        {labels.map(b => (
          <span key={b} className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-accent">{b}</span>
        ))}
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

      {company.description && <p className="mt-6 text-[1.12rem] leading-[1.7] text-ink font-body">{company.description}</p>}

      {/* Funding */}
      {(company.funding > 0 || (company.fundingRounds?.length > 0)) && (
        <Section icon={Banknote} title="Funding" note={company.latestRound ? `Latest: ${company.latestRound} ${company.roundYear || ''}`.trim() : null}>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <div>
              <div className="font-serif text-3xl font-semibold text-ink">{company.funding > 0 ? fmtMoney(company.funding) : '—'}</div>
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
          <p className="mt-4 text-[12px] text-muted font-sans">
            {company.fundingSource?.includes('sec') ? 'Rounds from SEC EDGAR Form D filings' : 'Curated figures'}
            {company.fundingSource?.includes('curated') && company.fundingSource?.includes('sec') ? ' + curated' : ''}.
          </p>
        </Section>
      )}

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
              <Prov source="openFDA" via="made_by" updated={g.provenance.devices} />
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
                  <Prov source="openFDA" via="cleared_via" updated={g.provenance.regulatory} />
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
              <Prov source="ClinicalTrials.gov" via="sponsored_by" updated={g.provenance.trials} />
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
        {pubs?.items?.length ? <Prov source="PubMed" via="author affiliation match" /> : null}
      </Section>

      {/* People — affiliated_with edge (People has no browse view; inbound only) */}
      <Section icon={Users} title="People" note={g && g.people.length ? `${g.people.length}` : null}>
        {!g ? <Loader /> : g.people.length === 0
          ? <p className="text-[14px] text-muted font-body">No researchers are linked to this organization yet.</p>
          : <>
              <div className="divide-y divide-rule">
                {g.people.map(p => (
                  <div key={p.id} className="py-2.5 flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[1.05rem] text-ink">{p.name}</span>
                    {p.role && <span className="text-[12px] font-sans text-muted whitespace-nowrap">{p.role}</span>}
                  </div>
                ))}
              </div>
              <Prov source="derived" via="affiliated_with" />
            </>}
      </Section>

      {/* Patents */}
      <Section icon={ScrollText} title="Patents" note={related ? `${related.patentCount.toLocaleString()} assigned` : null}>
        {!related ? <Loader /> : related.patents.length === 0
          ? <p className="text-[14px] text-muted font-body">No patents matched to this assignee in the index.</p>
          : <div className="divide-y divide-rule">
              {related.patents.map(p => (
                <RowLink key={p.patent_number} href={p.url}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[1.05rem] text-ink leading-snug group-hover:text-accent">{p.title}</span>
                    <span className="text-[12px] font-mono text-muted whitespace-nowrap">{yearOf(p.grant_date)}</span>
                  </div>
                </RowLink>
              ))}
            </div>}
      </Section>

      {/* Press / news */}
      <Section icon={Newspaper} title="In the news">
        {related?.news?.length > 0 && (
          <div className="divide-y divide-rule mb-3">
            {related.news.map(n => (
              <RowLink key={n.id} href={n.url}>
                <div className="font-serif text-[1.05rem] text-ink leading-snug group-hover:text-accent">{n.title}</div>
                <div className="mt-1 text-[12px] font-sans text-muted">{[n.source, yearOf(n.published_at)].filter(Boolean).join(' · ')}</div>
              </RowLink>
            ))}
          </div>
        )}
        <a href={newsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans text-accent hover:underline">
          Latest press & news on Google News <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </Section>

      {/* Jobs */}
      <Section icon={Briefcase} title="Careers">
        <div className="flex flex-wrap gap-3">
          {company.website && (
            <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3.5 py-1.5 rounded-full border border-rule text-ink-soft hover:border-ink transition-colors">
              Company site <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <a href={jobsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-sans px-3.5 py-1.5 rounded-full border border-rule text-ink-soft hover:border-ink transition-colors">
            Open roles on LinkedIn <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </Section>

      {/* Page-level provenance: what fed this dossier and how fresh it is. */}
      <footer className="border-t-2 border-ink mt-12 pt-4 text-[12px] font-sans text-muted leading-relaxed">
        <span className="font-semibold text-ink-soft">Sources: </span>{pageSources.join(', ')}.
        {pageUpdated && <> Oldest linked record updated {fmtDate(pageUpdated)}.</>} Devices, regulatory records, and trials are assembled from typed relationships in the index, not name guesses. Funding and patents are business context, shown separately and never used in any research ranking.
      </footer>
    </article>
  )
}
