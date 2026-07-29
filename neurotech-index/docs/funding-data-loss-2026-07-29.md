# Incident: the nightly cron destroyed the funding dataset

**29 July 2026. Cause found, fixed, data restored. One invariant to keep.**

## What was lost

Everything the funding pipeline had written to `organizations`, plus the whole
`funding_rounds` table:

| | before | after the cron |
|---|---|---|
| companies with `total_raised_usd` | 205 | 0 |
| `funding_rounds` rows | 629 | 0 |
| `inclusion_basis` | 63 | 0 |
| `furthest_stage` | 90 | 0 |
| `status` | 30 | 0 |
| `cik` | ~230 | 0 |

`latest_raise_unavailable_reason` was non-null on every row at its column
default, `unverified`, which is the signature of rows that were **re-created**
rather than updated.

## Cause

`scripts/backfill-companies.js` ended with:

```js
await sb.from('organizations').delete().eq('type', 'company')
// ...then insert all 1,084 rows fresh
```

Delete-and-insert was safe for as long as this script was the only writer of a
company row. `scripts/lib/uuid.js` even documents the design: ids are a
deterministic UUIDv5 of the company name precisely so that rebuilding the table
nightly does not break `/company/:id` URLs.

Migration 008 ended that. Putting funding on `organizations` made a second
pipeline an owner of columns on rows that a first pipeline deletes every night.
The delete also cascaded: `funding_rounds.organization_id` is declared
`on delete cascade`, so 629 rounds sourced from individual SEC filings went with
the company rows.

The cron (`.github/workflows/refresh.yml`, `0 6 * * *`) runs
`backfill-companies.js` before `backfill-funding.js`, and it runs from `main`.

Nothing about this was visible from the funding code. The funding work was
written, reviewed and verified on 28 July; the wipe happened on the next
scheduled run.

## Fix

`backfill-companies.js` now upserts on the deterministic id and prunes
separately. An upsert only touches the columns present in the payload, so
columns another pipeline owns survive untouched.

Pruning is by id difference rather than a blanket delete. A company that has
left the source lists **but still carries a funding figure is kept and
reported**, not deleted, because discarding sourced filings is a curation
decision rather than cleanup.

Verified before restoring anything, by planting a sentinel value on a real
company row, running the full companies backfill, and confirming the sentinel
survived while the ingest still refreshed the row's description.

## The invariant

> `organizations` has more than one owner. Any script that writes company rows
> upserts the columns it owns. Nothing deletes a row to update it.

This applies to `scripts/backfill-labs.js` too, which still does
`delete().eq('type', 'lab')`. Labs carry no funding columns, so nothing was lost
there, but the pattern is the same one and it will bite the first time a second
pipeline writes to a lab row.

## Also worth knowing

- A stray duplicate row exists for at least Neuralink with `type` set to
  `'Company'` (capitalised) and a random v4 id, left by an older ingest. Every
  query filters `type = 'company'`, so it is unreachable from the UI and was
  invisible to the prune. Harmless today; worth cleaning up.
- Restoring took about 90 minutes, almost all of it the rate-limited EDGAR
  sweep. The three cheap backfills (status, inclusion, stage) are seconds each,
  because their inputs are committed decision files and already-ingested FDA and
  trial records.
