# The company research layer

Added 20 August 2026.

`src/data/company-research.json` is a web-researched overlay on the company
pages. It carries three things the ingest pipeline cannot reach: reported
funding figures, the people who run a company, and whether that company still
exists. It also carries a suppression list of records a primary-source check
found do not belong to the company they were linked to.

It is built by `scripts/apply-enrichment.js` from batch files in
`scratch/enrich/out/` and `scratch/enrich/vout/`, which are produced by web
search. `scratch/` is gitignored; the overlay is not, and that asymmetry is the
point: the working notes are disposable, the published facts are reviewable.

## Why it is a file and not the database

`organizations` has ONE funding slot: `total_raised_usd` with a
`total_raised_confidence` beside it. 203 companies hold a `filing_verified`
figure there, and that figure is the number the Form D table on the company page
adds up to. A reader can check it filing by filing.

Press reporting frequently disagrees with it, in both directions:

| Company | Reported | In filings |
|---|---|---|
| Neurable | $65M | $12M |
| Ellipsis Health | $80M | $4M |
| Paradromics | $121M | $134M |

Neither number is the other's correction. Form D covers private US capital only,
so it misses foreign rounds and everything raised after a listing, which is why
the reported figure is usually larger. It also misses nothing at all for a
company that filed diligently, which is why it is sometimes larger than the
press total, since aggregators cannot count a round whose size was never
disclosed.

Writing either over the other loses information. So both are carried and the
page prints them side by side, each linking to what it was read from. The
database stays the primary-source layer and the overlay stays the reported one.

The other reason is the write invariant. On 29 July 2026 a nightly job destroyed
205 funding totals through a write that looked safe
(`docs/funding-data-loss-2026-07-29.md`). An overlay cannot do that: it is a
diff, and reverting it is a git operation rather than a restore.

## Why removals are suppressions

`getCompanyRelated` cross-links by `ILIKE` against `devices.manufacturer`,
`patents.assignee` and `news_feed.metadata->>sponsor`. That produces name
collisions. The first one this pass found: a PubMed paper on NeuroBase's
CogniScent page belongs to a DIFFERENT CogniScent, a chemical vapour-sensor
company in Weston, Massachusetts.

A verdict of `remove` does not delete the paper, the trial or the device. It adds
its PMID, NCT id or name to a `suppress` block on the company, and `data.js`
filters it in `getOrgGraph` and `getCompanyAnalytics`. Three reasons:

1. The record is usually correct for some OTHER organisation. Deleting it would
   lose a true fact to fix a false link.
2. The correction carries its reason and its source next to it, in a diff.
3. Undoing one is deleting a line.

Publication totals are recomputed when the list is filtered, or the section
header would keep counting a paper the list no longer shows.

**`uncertain` is never suppressed.** A record a checker could not reach stays on
the page. A doubtful record a reader can see is better than a missing one they
cannot, and the verification brief says to default to `uncertain` rather than
`remove` whenever a primary source is out of reach.

## Pictures: a mark is not a photograph

54 of the 61 company pictures were under 400px wide and most were exactly
180x180. Their URLs said what they were: `apple-touch-icon.png`, `favicon.png`,
`webclip.png`. `siteIcon` in `scripts/lib/images.js` fetches those deliberately
and its comment is explicit — "Small by nature, so it is a mark, not a photo."

Nothing was wrong with that until the company page put the mark in a 16:9 frame
the full width of the measure, which enlarged a 180px icon about four times.

Two rules now hold, and the first is the one that guarantees the result:

1. **Nothing is ever enlarged.** `isHiRes` in `src/lib/image.js` mirrors
   `HI_RES` in `scripts/lib/images.js` (longest side 900+, shortest 500+), the
   bar this project already applies to the lead slot. Clear it and a picture
   gets the frame. Fall short and it renders as a small mark beside the company
   name, capped at 56px and never scaled up. A picture with no recorded
   dimensions counts as a mark: guessing in a picture's favour is how the icon
   got to four times its size.

2. **A bigger picture is fetched where the site publishes one.**
   `scripts/upgrade-company-images.js` reads each company's `og:image`, the
   picture a site publishes for social cards, conventionally about 1200x630.
   238 of 1,081 companies had one that cleared both bars.

Both bars matter. `SANE_ASPECT` (3:1 either way, also already in the codebase)
rejects wordmark lockups that pass any resolution test and are still banners:
Flow Neuroscience's og:image is 35203x2922, which in a 16:9 frame arrives as a
sliver. Five were rejected on shape.

## The evidence bar

Every field in the overlay carries the URL it was read from. `apply-enrichment.js`
drops anything that arrives without one, and the drop is counted in
`scratch/enrich/apply-report.json` rather than passing silently.

A funding figure needs either two independent sources that agree, or one primary
source: an SEC filing, the company's own release, or a regulator. An aggregator
profile alone (Crunchbase, PitchBook, Tracxn) is recorded at `low` confidence and
the page says so in words, because a compilation and a filing are not equal
evidence and the size of the type should not have to carry that distinction.

A person's role must be CURRENT, or it is dropped. Founders are the exception,
since founding is historical and stays true after a departure.

LinkedIn is never used, per the Phase 10 rule. `isUrl` in the apply script
rejects any linkedin.com URL outright, so the rule is enforced at the point of
write rather than trusted to the brief.

## Rebuilding it

```bash
node scripts/apply-enrichment.js            # dry run, prints counts and rejections
node scripts/apply-enrichment.js --commit   # writes the overlay
```

Both are safe to re-run: the script reads whatever batches exist and rewrites
the overlay from scratch, so a partial run is not a partial file.

## What this layer does NOT do

- It does not feed any ranking, the feed, or the research facets. It is business
  and biographical context, and the Phase 10 partition still holds.
- It does not touch Supabase. Nothing in this pass writes to the database.
- It does not appear on `/companies`. The index board reads the database, so a
  reported total shows on the company page and not on the funding board. That is
  a deliberate limit of an overlay, and the reason to keep the board honest to
  filings.
