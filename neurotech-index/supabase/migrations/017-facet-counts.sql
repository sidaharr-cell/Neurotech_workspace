-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017 — per-facet-value result counts for the filter bar
--
-- Run ONCE in the Supabase SQL editor.
--
-- The filter bar can print, beside each facet value, how many rows selecting it
-- would return, and hide the values that would return none. Until now only the
-- two lean tables carried those numbers, because the client counted them one
-- value at a time: 23 exact counts per page load. On papers that is not slow,
-- it is impossible — a single facet-filtered count over 61k fat rows already
-- exceeds the statement timeout (measured: 3.1s for a bare in_scope count,
-- cancelled at 3.3s once a facet filter was added).
--
-- So the counts move server-side into ONE grouped query, and an index is added
-- that the query can be answered entirely from.
--
--   1. the covering btree carries in_scope AND all three facet arrays. Every
--      column the RPC reads is in it, so the scan is index-only and never
--      touches the fat heap rows (abstracts, MeSH jsonb, tsvectors). This is
--      the same trick migration 002 played for the year histogram, which is why
--      an unfiltered grouped scan of papers returns in ~375ms.
--
--   2. facet_counts() unnests each facet column and counts rows per value,
--      holding the OTHER two dimensions' current selections fixed. That is the
--      standard faceted-count semantic: the number answers "how many results if
--      I add this value", not "how many results do I have now".
--
-- The client hides all counts if this returns an error, so the filter bar keeps
-- working exactly as it does today until this migration is applied.
--
-- NOTE: no VACUUM here — the Supabase SQL editor runs statements in a
-- transaction, and VACUUM cannot run inside one. Autovacuum maintains the
-- visibility map that index-only scans rely on.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The covering indexes ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['devices', 'patents']
  loop
    execute format(
      'create index if not exists %I on %I (in_scope, facet_function, facet_access, facet_application)',
      t || '_facet_count_idx', t);
  end loop;
end $$;

-- papers carries one more gate than the others: searchPapers hides the rows that
-- were merged into a canonical version (migration 006), so the count has to hide
-- them too or it promises duplicates the results will not show. canonical_id
-- sits in the index beside in_scope, or that predicate would send the scan to
-- the heap and the timeout this migration exists to avoid comes straight back.
-- Dropped rather than "if not exists", so re-running this file widens an index
-- created by an earlier version of it instead of silently keeping the old shape.
drop index if exists papers_facet_count_idx;
create index papers_facet_count_idx
  on papers (in_scope, canonical_id, facet_function, facet_access, facet_application);

-- news_feed and organizations are each two collections in one table (trials
-- versus press; companies versus labs), and every page that reads them reads
-- one of the two. The kind column joins the index directly after in_scope, so
-- those queries stay index-only too, and an unfiltered call can still scan the
-- whole index.
create index if not exists news_feed_facet_count_idx
  on news_feed (in_scope, entry_type, facet_function, facet_access, facet_application);
create index if not exists organizations_facet_count_idx
  on organizations (in_scope, type, facet_function, facet_access, facet_application);

-- Refresh planner stats for the indexes just built. Without this the FIRST query
-- against a new index can pick a bad plan and hit the statement timeout while
-- every later one runs in ~200ms — measured here on papers, where the first call
-- took 3.2s and timed out and the next took 197ms. The counts degrade safely
-- when that happens, but the first reader after a rebuild should not be the one
-- who pays for it. ANALYZE runs inside a transaction; VACUUM, which would also
-- set the visibility map these index-only scans want, does not, so autovacuum is
-- left to do that part.
analyze papers;
analyze devices;
analyze patents;
analyze news_feed;
analyze organizations;

-- ── The grouped count ───────────────────────────────────────────────────────
-- p_table     papers | devices | patents | news_feed | organizations
-- p_fn/ax/ap  the currently selected values of each dimension (empty = no filter)
-- p_kind      news_feed.entry_type / organizations.type values to keep; empty
--             means every kind, and it is ignored for the other three tables
-- p_all_scopes  keep out-of-scope rows, matching the callers that do. The
--             organizations searches pass includeOutOfScope, because a lab that
--             abstains is unclassified rather than off topic and the gate would
--             hide it; a count that gated where its search does not is a number
--             the results would not honour.
--
-- Returns one row per (dimension, value) present in the data. A value absent
-- from the result has no matching rows, which is what lets the bar hide it.
--
-- Plus ONE row with dim='total': the exact number of rows the CURRENT selection
-- returns, all three dimensions applied. The pages print that as "N results"
-- when nothing outside this function narrows them, because the two numbers they
-- printed before were both wrong. searchPapers and searchPatents count
-- `estimated` — a planner guess, measured 25-28% low — because an exact count
-- over the fat tables used to time out, which the covering index below is
-- exactly what fixes. And the year histogram's bucket sum, used as the total
-- where the estimate was too embarrassing, silently drops every row it cannot
-- place: an unparseable date, or a year outside the buckets it emits (a trial
-- dated 2027 is counted and then never rendered). It costs nothing to add here:
-- same index, same scan, no extra round trip.
create or replace function facet_counts(
  p_table      text,
  p_fn         text[] default '{}',
  p_ax         text[] default '{}',
  p_ap         text[] default '{}',
  p_kind       text[] default '{}',
  p_all_scopes boolean default false
)
returns table (dim text, val text, n bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  kind_col  text;
  kind_sql  text := '';
  scope_sql text;
  dedup_sql text := '';
begin
  -- Whitelist the table name: it is interpolated into dynamic SQL as an
  -- identifier, so nothing outside this list may reach it.
  if p_table not in ('papers', 'devices', 'patents', 'news_feed', 'organizations') then
    raise exception 'facet_counts: unknown table %', p_table;
  end if;

  kind_col := case p_table
    when 'news_feed' then 'entry_type'
    when 'organizations' then 'type'
    else null
  end;
  -- The kind values are inlined rather than bound, because the three dimension
  -- arrays are the only USING parameters and a bound $4 that some branches do
  -- not reference is an error. format's %L quotes the array literal, so an
  -- unexpected value is a failed cast and not an injection.
  if kind_col is not null and coalesce(cardinality(p_kind), 0) > 0 then
    kind_sql := format(' and t.%I = any(%L::text[])', kind_col, p_kind);
  end if;

  -- The scope gate is a constant, not a bound parameter, so the planner keeps
  -- the leading in_scope key of the covering index rather than filtering on it.
  scope_sql := case when coalesce(p_all_scopes, false) then 'true' else 't.in_scope' end;

  -- Every gate the page's search applies, the count must apply too, or the
  -- number is a promise the results do not keep. searchPapers is the only one
  -- with a gate beyond scope and kind: it drops rows merged into a canonical
  -- version. Guarded on the column existing, so this file stays runnable if
  -- migration 006 has not been applied.
  if p_table = 'papers' and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'papers' and column_name = 'canonical_id'
  ) then
    dedup_sql := ' and t.canonical_id is null';
  end if;

  -- One branch per dimension: the dimension being counted is unnested and
  -- grouped, the other two are applied as filters. `&&` on a text[] is set
  -- intersection, which is OR within a dimension; the three predicates are
  -- ANDed, which is AND across dimensions — the same semantics as applyFacets
  -- in src/lib/data.js.
  return query execute format($q$
    select 'function'::text, u.v, count(*)
      from %1$I t, unnest(t.facet_function) as u(v)
     where %3$s
       and (cardinality($2) = 0 or t.facet_access && $2)
       and (cardinality($3) = 0 or t.facet_application && $3)
       %2$s %4$s
     group by u.v
    union all
    select 'access'::text, u.v, count(*)
      from %1$I t, unnest(t.facet_access) as u(v)
     where %3$s
       and (cardinality($1) = 0 or t.facet_function && $1)
       and (cardinality($3) = 0 or t.facet_application && $3)
       %2$s %4$s
     group by u.v
    union all
    select 'application'::text, u.v, count(*)
      from %1$I t, unnest(t.facet_application) as u(v)
     where %3$s
       and (cardinality($1) = 0 or t.facet_function && $1)
       and (cardinality($2) = 0 or t.facet_access && $2)
       %2$s %4$s
     group by u.v
    union all
    -- The total. No unnest and no dimension left free: this is the selection
    -- itself, so a row carrying no facet at all still counts when nothing is
    -- selected, exactly as the page's own search counts it.
    select 'total'::text, ''::text, count(*)
      from %1$I t
     where %3$s
       and (cardinality($1) = 0 or t.facet_function && $1)
       and (cardinality($2) = 0 or t.facet_access && $2)
       and (cardinality($3) = 0 or t.facet_application && $3)
       %2$s %4$s
  $q$, p_table, kind_sql, scope_sql, dedup_sql)
  using coalesce(p_fn, '{}'::text[]), coalesce(p_ax, '{}'::text[]), coalesce(p_ap, '{}'::text[]);
end $$;

grant execute on function facet_counts(text, text[], text[], text[], text[], boolean) to anon, authenticated;

-- PostgREST resolves RPCs from a cached schema, and the browser gets a 404
-- naming the function it just created until that cache is reloaded. Supabase
-- reloads it on its own, but not always immediately; this makes it definite.
notify pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select * from facet_counts('papers') order by dim, n desc;
--   -- the dim='total' row must equal the page's "N results" for that selection
-- select * from facet_counts('news_feed', '{}', '{minimally_invasive}', '{}', '{trial}');
-- select * from facet_counts('news_feed', '{}', '{}', '{}', '{trial}') order by dim, n desc;
-- select * from facet_counts('organizations', '{}', '{}', '{}', '{company}', true) order by dim, n desc;
-- explain (analyze, buffers) select * from facet_counts('papers');
--   -- expect "Index Only Scan using papers_facet_count_idx"; a Seq Scan means
--   -- the index was not created, or autovacuum has not yet set the visibility
--   -- map the index-only scan needs.
