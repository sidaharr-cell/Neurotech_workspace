import { useState, Children } from 'react'
import { ChevronDown } from 'lucide-react'
import { SectionHeading } from '../components/ui'

/* A labeled block explaining one content type's ranking signals. */
function RankCard({ type, lead, signals }) {
  return (
    <div className="border border-rule rounded-sm bg-canvas/40 p-5">
      <h3 className="font-serif text-xl font-semibold text-ink mb-1">{type}</h3>
      <p className="text-[14px] leading-relaxed text-ink-soft font-body mb-3">{lead}</p>
      <ul className="space-y-1.5">
        {signals.map((s, i) => (
          <li key={i} className="flex gap-2 text-[13.5px] leading-snug text-ink-soft font-sans">
            <span className="text-accent mt-[3px]">▸</span>
            <span><span className="font-semibold text-ink">{s.k}:</span> {s.v}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* A scoring formula with a plain-language legend for each term. */
function Equation({ title, formula, terms, note }) {
  return (
    <div className="mb-6">
      <h3 className="font-sans text-[13px] font-semibold text-ink mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <code className="block font-mono text-[12.5px] leading-relaxed text-ink bg-canvas border border-rule rounded-sm px-3 py-2 whitespace-nowrap">{formula}</code>
      </div>
      {terms && (
        <ul className="mt-2.5 space-y-1">
          {terms.map(([k, v], i) => (
            <li key={i} className="text-[13px] leading-snug text-ink-soft font-sans">
              <span className="font-mono text-ink">{k}</span> {v}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-2.5 text-[13px] leading-relaxed text-muted font-body">{note}</p>}
    </div>
  )
}

/* One disclosed data source with what we take from it and a link. */
function Source({ name, url, note }) {
  return (
    <li className="py-2 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5">
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-sans text-[14px] font-medium text-ink hover:text-accent underline decoration-rule underline-offset-2 shrink-0">
        {name}
      </a>
      <span className="font-sans text-[13px] text-muted sm:text-right sm:max-w-[62%]">{note}</span>
    </li>
  )
}

/* A collapsible category of sources. Click the header to expand or collapse. */
function SourceGroup({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const n = Children.count(children)
  return (
    <div className="border-b border-rule">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-3.5 text-left group">
        <span className="font-sans text-[12.5px] font-semibold uppercase tracking-[0.1em] text-accent group-hover:text-ink transition-colors">
          {title} <span className="text-muted font-normal normal-case tracking-normal">· {n} source{n === 1 ? '' : 's'}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <ul className="pb-3 -mt-0.5">{children}</ul>}
    </div>
  )
}

export default function HowItWorks() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="About"
        title="How NeuroBase works"
        sub="NeuroBase is an open, automatically updated index of neurotechnology. Nothing here is hand-picked by an editor. Every story is gathered from public sources and ranked by a transparent, published set of rules. This page explains exactly how, and lists every source we pull from."
      />

      {/* ── Ranking, plain language ─────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-serif text-2xl sm:text-[1.7rem] font-semibold text-ink tracking-[-0.01em] mb-3">How stories rise to the top</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft font-body mb-5">
          Every night, a robot collects new neurotechnology research, news, trials, devices, labs, and company
          filings. Each item gets a score, and the highest-scoring items surface to the top of the feed.
          "Important" means something different for a research paper than for a news story or a clinical trial, so
          <span className="text-ink font-medium"> each type is scored on its own terms</span>:
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <RankCard
            type="Research & preprints"
            lead="Papers are ranked mostly by real scientific impact, not by our opinion."
            signals={[
              { k: 'Citation impact', v: 'how much other scientists cite it, adjusted for its field and age (via OpenAlex) so a brand-new landmark is not buried under older work' },
              { k: 'Relevance', v: 'how central it is to neurotechnology, judged by AI (see below)' },
              { k: 'Journal standing', v: 'the reputation of where it was published' },
              { k: 'Recency', v: 'newer work ranks higher, fading gradually over months' },
            ]}
          />
          <RankCard
            type="News & media"
            lead="Coverage is ranked for credibility and freshness, since news dates quickly."
            signals={[
              { k: 'Outlet authority', v: 'established science and news outlets rank above aggregators' },
              { k: 'Relevance', v: 'stories unrelated to the brain or nervous system are scored low and removed' },
              { k: 'Recency', v: 'news decays fast, so a story’s weight roughly halves every few days' },
            ]}
          />
          <RankCard
            type="Clinical trials"
            lead="Trials are ranked by how significant and active the study is."
            signals={[
              { k: 'Phase', v: 'later-stage trials (Phase 3 or 4) rank above early ones' },
              { k: 'Status', v: 'actively recruiting studies rank above completed or halted ones' },
              { k: 'Size & sponsor', v: 'larger enrollment and established sponsors rank higher' },
              { k: 'Recency', v: 'more recently started trials rank higher' },
            ]}
          />
          <RankCard
            type="Labs & companies"
            lead="Organizations are ranked by objective, public measures of activity."
            signals={[
              { k: 'Labs', v: 'ranked by total NIH research funding and how recently and actively they are funded' },
              { k: 'Companies', v: 'ranked by capital raised, drawn from public SEC filings' },
            ]}
          />
        </div>

        <div className="mt-6 border-l-2 border-accent pl-4 py-1">
          <p className="text-[15px] leading-relaxed text-ink-soft font-body">
            <span className="font-semibold text-ink">The lead story</span>, the large story at the top of the
            homepage, has an extra requirement. It must come from a <span className="text-ink font-medium">reputable
            source</span> (a peer-reviewed journal or an established outlet, never a press-release aggregator) and be
            <span className="text-ink font-medium"> squarely about neurotechnology</span>, not general science.
          </p>
        </div>
      </section>

      {/* ── The exact formulas ──────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-serif text-2xl sm:text-[1.7rem] font-semibold text-ink tracking-[-0.01em] mb-3">The exact formulas</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft font-body mb-6">
          For full transparency, here are the exact scoring formulas. Every term is scaled from 0 to 1, and the
          weights in each formula add up to 1, so every score lands between 0 and 1. "Recency" always means
          0.5 raised to the age divided by a half-life, so a signal loses half its weight over that period.
        </p>

        <Equation
          title="Research & preprints"
          formula="score = 0.30×impact + 0.28×relevance + 0.22×recency + 0.10×velocity + 0.10×prestige"
          terms={[
            ['impact', 'is the OpenAlex citation percentile for the paper’s field and year (top 1% = 0.99).'],
            ['relevance', 'is the AI relevance rating divided by 10.'],
            ['recency', 'is 0.5^(age in days / 180), a 180-day half-life.'],
            ['velocity', 'is recent citations, log-scaled.'],
            ['prestige', 'is the journal’s tier, from 0.4 to 1.0.'],
          ]}
          note="If a paper is too new to trust its citations (fewer than 3 citations and under 60 days old), the impact term is dropped and its 0.30 weight is shared across the other four, so fresh work competes on relevance, recency, and journal standing until its citations accrue."
        />

        <Equation
          title="News & media"
          formula="score = 0.40×relevance + 0.35×recency + 0.25×authority"
          terms={[
            ['relevance', 'is the AI relevance rating divided by 10.'],
            ['recency', 'is 0.5^(age in days / 3), a 3-day half-life, because news dates fast.'],
            ['authority', 'is the outlet tier, from 0.4 (aggregator) to 1.0 (top-tier journal or newsroom).'],
          ]}
        />

        <Equation
          title="Clinical trials"
          formula="score = 0.28×phase + 0.18×status + 0.17×recency + 0.14×size + 0.10×topical + 0.08×sponsor + 0.05×results"
          terms={[
            ['phase', 'rises with trial phase (Phase 4 = 1.0, down to 0.25 for no listed phase).'],
            ['status', 'is highest for recruiting trials, lowest for withdrawn or terminated ones.'],
            ['recency', 'is 0.5^(age in days / 730), a 2-year half-life.'],
            ['size', 'is enrollment, log-scaled.'],
            ['topical', 'is 1 if the trial maps to a device class, otherwise 0.4.'],
            ['sponsor', 'is 0.85 for industry, 0.8 for NIH, 0.55 otherwise.'],
            ['results', 'is 1 if results are posted, otherwise 0.'],
          ]}
        />

        <Equation
          title="Research labs"
          formula="score = 0.45×funding + 0.30×projects + 0.25×recency"
          terms={[
            ['funding', 'is total NIH award dollars, log-scaled.'],
            ['projects', 'is the number of funded projects, log-scaled.'],
            ['recency', 'is 0.5^(years since last award / 3), a 3-year half-life.'],
          ]}
          note="Companies use no weighted formula. They are ranked directly by total capital raised from SEC filings, and you can re-sort the chart by latest round size or date."
        />

        <Equation
          title="Notable research rail"
          formula="score = 0.72×impact + 0.15×prestige + 0.13×velocity"
          note="The homepage rail of landmark papers is impact-first, since these are older papers whose citations have had time to accumulate."
        />
      </section>

      {/* ── AI role ─────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-serif text-2xl sm:text-[1.7rem] font-semibold text-ink tracking-[-0.01em] mb-3">Where AI fits in</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft font-body">
          An AI model (Anthropic's Claude) reads each new item and does three things. It rates how relevant the
          item is to neurotechnology, writes the plain-language "why it matters" summary you see on detail pages, and
          tags the item by device type. The AI's relevance rating is <span className="text-ink font-medium">one input
          among several</span>. The citation, trial, and funding signals above come from hard public data, not from
          the AI. Items the AI judges unrelated to the brain or nervous system are scored low and dropped from the feed.
        </p>
        <p className="text-[15px] leading-relaxed text-ink-soft font-body mt-3">
          The <span className="text-ink font-medium">"Notable research" rail</span> on the homepage is a separate,
          longer-running shortlist of the highest citation-impact papers from the past 90 days, so landmark work stays
          visible even after it leaves the weekly feed.
        </p>
      </section>

      {/* ── Sources ─────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-serif text-2xl sm:text-[1.7rem] font-semibold text-ink tracking-[-0.01em] mb-1">Where our information comes from</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft font-body mb-6">
          Everything on NeuroBase is drawn from the public sources below. We store only short index cards
          (titles, abstracts, links, and metadata), never paywalled full text, and every item links back to its
          original source.
        </p>

        <div className="border-t border-rule">
        <SourceGroup title="Research papers & preprints" defaultOpen>
          <Source name="PubMed (NCBI)" url="https://pubmed.ncbi.nlm.nih.gov" note="peer-reviewed biomedical literature" />
          <Source name="arXiv" url="https://arxiv.org" note="preprints in physics, CS, and quantitative biology" />
        </SourceGroup>

        <SourceGroup title="Citation & impact data (used for ranking)">
          <Source name="OpenAlex" url="https://openalex.org" note="field- and age-normalized citation impact" />
          <Source name="Semantic Scholar" url="https://www.semanticscholar.org" note="citation counts" />
        </SourceGroup>

        <SourceGroup title="Clinical trials">
          <Source name="ClinicalTrials.gov" url="https://clinicaltrials.gov" note="the U.S. registry of clinical studies (API v2)" />
        </SourceGroup>

        <SourceGroup title="Devices">
          <Source name="openFDA" url="https://open.fda.gov" note="FDA 510(k) clearances and PMA approvals" />
        </SourceGroup>

        <SourceGroup title="Research labs">
          <Source name="NIH RePORTER" url="https://reporter.nih.gov" note="NIH-funded projects and award amounts" />
        </SourceGroup>

        <SourceGroup title="Companies & funding">
          <Source name="SEC EDGAR" url="https://www.sec.gov/edgar" note="Form D capital-raise filings" />
        </SourceGroup>

        <SourceGroup title="News & media (RSS + aggregators)">
          <Source name="Nature" url="https://www.nature.com/subjects/neuroscience" note="neuroscience news feed" />
          <Source name="STAT" url="https://www.statnews.com" note="health and biotech journalism" />
          <Source name="The Transmitter" url="https://www.thetransmitter.org" note="neuroscience news (Simons Foundation)" />
          <Source name="MIT News" url="https://news.mit.edu/rss/topic/neuroscience" note="neuroscience research news" />
          <Source name="IEEE Spectrum" url="https://spectrum.ieee.org" note="biomedical engineering coverage" />
          <Source name="eLife" url="https://elifesciences.org" note="open-access life-sciences research" />
          <Source name="Science News" url="https://www.sciencenews.org" note="general science journalism" />
          <Source name="Frontiers" url="https://www.frontiersin.org/journals/neuroscience" note="open-access neuroscience" />
          <Source name="Medgadget" url="https://www.medgadget.com/category/neurology" note="medical device coverage" />
          <Source name="Fierce Biotech" url="https://www.fiercebiotech.com" note="biotech industry news" />
          <Source name="ScienceDaily, Neuroscience News, Singularity Hub, New Atlas" url="https://www.sciencedaily.com/news/mind_brain/neuroscience/" note="science press aggregators (ranked below primary outlets)" />
          <Source name="Google News" url="https://news.google.com" note="broad neurotech search feed" />
          <Source name="GDELT" url="https://www.gdeltproject.org" note="global news index" />
          <Source name="Mastodon" url="https://mastodon.social/tags/neurotech" note="public posts on neurotech hashtags" />
        </SourceGroup>

        <SourceGroup title="AI">
          <Source name="Anthropic Claude" url="https://www.anthropic.com" note="relevance rating, plain-language summaries, and tagging" />
        </SourceGroup>
        </div>
      </section>

      {/* ── Limitations ─────────────────────────────────────── */}
      <section className="mt-10 mb-4">
        <h2 className="font-serif text-2xl sm:text-[1.7rem] font-semibold text-ink tracking-[-0.01em] mb-3">Honest limitations</h2>
        <ul className="space-y-2.5">
          {[
            ['Citations lag.', 'A paper published this week has no citations yet, so brand-new work is ranked on relevance, journal, and recency until its impact accrues. The ranking then updates automatically each night.'],
            ['Trial dates.', 'Not-yet-recruiting trials show an estimated start date provided by ClinicalTrials.gov, labeled "Starts" rather than "Started".'],
            ['No personalization.', 'Ranking is the same for everyone. "Most significant" reflects objective signals, not what any individual user cares about.'],
            ['AI can be wrong.', 'The relevance rating and summaries are generated by an AI model and may occasionally misjudge an item. They are inputs to ranking, not the final word, and every item links to its primary source so you can check.'],
          ].map(([k, v], i) => (
            <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink-soft font-body">
              <span className="text-accent mt-[5px]">•</span>
              <span><span className="font-semibold text-ink">{k}</span> {v}</span>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[13px] text-muted font-sans">
          NeuroBase is an independent, open project and is not affiliated with any institution or the sources listed above.
        </p>
      </section>
    </div>
  )
}
