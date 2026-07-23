# How NeuroBase works

NeuroBase is an open, automatically updated index of neurotechnology. Nothing here is hand-picked by an editor. Every story is gathered from public sources and ranked by a transparent, published set of rules. This page explains exactly how, and lists every source we pull from.

---

## How stories rise to the top

Every night, a robot collects new neurotechnology research, news, trials, devices, labs, and company filings. Each item gets a score, and the highest-scoring items surface to the top of the feed. "Important" means something different for a research paper than for a news story or a clinical trial, so **each type is scored on its own terms**:

### Research & preprints
Papers are ranked mostly by real scientific impact, not by our opinion.

- **Citation impact:** how much other scientists cite it, adjusted for its field and age (via OpenAlex) so a brand-new landmark is not buried under older work
- **Relevance:** how central it is to neurotechnology, judged by AI (see below)
- **Journal standing:** the reputation of where it was published
- **Recency:** newer work ranks higher, fading gradually over months

### News & media
Coverage is ranked for credibility and freshness, since news dates quickly.

- **Outlet authority:** established science and news outlets rank above aggregators
- **Relevance:** stories unrelated to the brain or nervous system are scored low and removed
- **Recency:** news decays fast, so a story's weight roughly halves every few days

### Clinical trials
Trials are ranked by how significant and active the study is.

- **Phase:** later-stage trials (Phase 3 or 4) rank above early ones
- **Status:** actively recruiting studies rank above completed or halted ones
- **Size & sponsor:** larger enrollment and established sponsors rank higher
- **Recency:** more recently started trials rank higher

### Labs & companies
Organizations are ranked by objective, public measures of activity.

- **Labs:** ranked by total NIH research funding and how recently and actively they are funded
- **Companies:** ranked by capital raised, drawn from public SEC filings

**The lead story**, the large story at the top of the homepage, has an extra requirement. It must come from a **reputable source** (a peer-reviewed journal or an established outlet, never a press-release aggregator) and be **squarely about neurotechnology**, not general science.

---

## The exact formulas

For full transparency, here are the exact scoring formulas. Every term is scaled from 0 to 1, and the weights in each formula add up to 1, so every score lands between 0 and 1. "Recency" always means 0.5 raised to the age divided by a half-life, so a signal loses half its weight over that period.

### Research & preprints
```
score = 0.30×impact + 0.28×relevance + 0.22×recency + 0.10×velocity + 0.10×prestige
```
- **impact** is the OpenAlex citation percentile for the paper's field and year (top 1% = 0.99).
- **relevance** is the AI relevance rating divided by 10.
- **recency** is 0.5^(age in days / 180), a 180-day half-life.
- **velocity** is recent citations, log-scaled.
- **prestige** is the journal's tier, from 0.4 to 1.0.

*If a paper is too new to trust its citations (fewer than 3 citations and under 60 days old), the impact term is dropped and its 0.30 weight is shared across the other four, so fresh work competes on relevance, recency, and journal standing until its citations accrue.*

### News & media
```
score = 0.40×relevance + 0.35×recency + 0.25×authority
```
- **relevance** is the AI relevance rating divided by 10.
- **recency** is 0.5^(age in days / 3), a 3-day half-life, because news dates fast.
- **authority** is the outlet tier, from 0.4 (aggregator) to 1.0 (top-tier journal or newsroom).

### Clinical trials
```
score = 0.28×phase + 0.18×status + 0.17×recency + 0.14×size + 0.10×topical + 0.08×sponsor + 0.05×results
```
- **phase** rises with trial phase (Phase 4 = 1.0, down to 0.25 for no listed phase).
- **status** is highest for recruiting trials, lowest for withdrawn or terminated ones.
- **recency** is 0.5^(age in days / 730), a 2-year half-life.
- **size** is enrollment, log-scaled.
- **topical** is 1 if the trial maps to a neurotech facet, otherwise 0.4.
- **sponsor** is 0.85 for industry, 0.8 for NIH, 0.55 otherwise.
- **results** is 1 if results are posted, otherwise 0.

### Research labs
```
score = 0.45×funding + 0.30×projects + 0.25×recency
```
- **funding** is total NIH award dollars, log-scaled.
- **projects** is the number of funded projects, log-scaled.
- **recency** is 0.5^(years since last award / 3), a 3-year half-life.

*Companies use no weighted formula. They are ranked directly by total capital raised from SEC filings, and you can re-sort the chart by latest round size or date.*

### Notable research rail
```
score = 0.72×impact + 0.15×prestige + 0.13×velocity
```
*The homepage rail of landmark papers is impact-first, since these are older papers whose citations have had time to accumulate.*

---

## Where AI fits in

An AI model (Anthropic's Claude) reads each new item and does three things. It rates how relevant the item is to neurotechnology, writes the plain-language "why it matters" summary you see on detail pages, and tags the item by device type. The AI's relevance rating is **one input among several**. The citation, trial, and funding signals above come from hard public data, not from the AI. Items the AI judges unrelated to the brain or nervous system are scored low and dropped from the feed.

The **"Notable research" rail** on the homepage is a separate, longer-running shortlist of the highest citation-impact papers from the past 90 days, so landmark work stays visible even after it leaves the weekly feed.

---

## Where our information comes from

Everything on NeuroBase is drawn from the public sources below. We store only short index cards (titles, abstracts, links, and metadata), never paywalled full text, and every item links back to its original source.

**Research papers & preprints**
- [PubMed (NCBI)](https://pubmed.ncbi.nlm.nih.gov) — peer-reviewed biomedical literature
- [arXiv](https://arxiv.org) — preprints in physics, CS, and quantitative biology

**Citation & impact data (used for ranking)**
- [OpenAlex](https://openalex.org) — field- and age-normalized citation impact
- [Semantic Scholar](https://www.semanticscholar.org) — citation counts

**Clinical trials**
- [ClinicalTrials.gov](https://clinicaltrials.gov) — the U.S. registry of clinical studies (API v2)

**Devices**
- [openFDA](https://open.fda.gov) — FDA 510(k) clearances and PMA approvals

**Research labs**
- [NIH RePORTER](https://reporter.nih.gov) — NIH-funded projects and award amounts

**Companies & funding**
- [SEC EDGAR](https://www.sec.gov/edgar) — Form D capital-raise filings

**News & media (RSS + aggregators)**
- [Nature](https://www.nature.com/subjects/neuroscience) — neuroscience news feed
- [STAT](https://www.statnews.com) — health and biotech journalism
- [The Transmitter](https://www.thetransmitter.org) — neuroscience news (Simons Foundation)
- [MIT News](https://news.mit.edu/rss/topic/neuroscience) — neuroscience research news
- [IEEE Spectrum](https://spectrum.ieee.org) — biomedical engineering coverage
- [eLife](https://elifesciences.org) — open-access life-sciences research
- [Science News](https://www.sciencenews.org) — general science journalism
- [Frontiers](https://www.frontiersin.org/journals/neuroscience) — open-access neuroscience
- [Medgadget](https://www.medgadget.com/category/neurology) — medical device coverage
- [Fierce Biotech](https://www.fiercebiotech.com) — biotech industry news
- ScienceDaily, Neuroscience News, Singularity Hub, New Atlas — science press aggregators (ranked below primary outlets)
- [Google News](https://news.google.com) — broad neurotech search feed
- [GDELT](https://www.gdeltproject.org) — global news index
- [Mastodon](https://mastodon.social/tags/neurotech) — public posts on neurotech hashtags

**AI**
- [Anthropic Claude](https://www.anthropic.com) — relevance rating, plain-language summaries, and tagging

---

## Honest limitations

- **Citations lag.** A paper published this week has no citations yet, so brand-new work is ranked on relevance, journal, and recency until its impact accrues. The ranking then updates automatically each night.
- **Trial dates.** Not-yet-recruiting trials show an estimated start date provided by ClinicalTrials.gov, labeled "Starts" rather than "Started".
- **No personalization.** Ranking is the same for everyone. "Most significant" reflects objective signals, not what any individual user cares about.
- **AI can be wrong.** The relevance rating and summaries are generated by an AI model and may occasionally misjudge an item. They are inputs to ranking, not the final word, and every item links to its primary source so you can check.

*NeuroBase is an independent, open project and is not affiliated with any institution or the sources listed above.*
