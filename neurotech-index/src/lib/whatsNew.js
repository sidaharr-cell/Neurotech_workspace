/**
 * whatsNew.js — everything the index gained today, and nothing else.
 *
 * One definition, two readers. The "What's new today?" window reads it through
 * the anon client in the browser; scripts/send-digest.js reads it through the
 * service key at the end of the daily run and posts the same list to whoever
 * asked for it by email. A digest that disagreed with the window would be worse
 * than no digest, so the queries, the grouping and the wording all live here and
 * both callers pass in a client.
 *
 * TODAY IS UTC. The daily run is a 6am UTC cron and `created_at` is stamped by
 * Postgres in UTC, so the day boundary has to be the same one the pipeline used
 * or a reader west of Greenwich opens the window in the evening and finds it
 * empty. src/lib/homepage.js takes the same view for the same reason.
 *
 * NOTHING HERE CALLS A MODEL. The two-sentence TLDR is extractive: the daily run
 * already wrote a one-line `summary` and, for research, a `metadata.significance`
 * paragraph, and this trims the best of those to two sentences. Adding a
 * summariser would mean an API call per new item per reader per day, which is
 * both a cost nobody agreed to and a page that cannot render without one.
 */
import { groupTrialChanges } from './trial-changes.js'

/** Rows to read per category. A day's ingest is tens, not thousands; the cap is
 *  a guard against a runaway backfill dumping ten thousand rows into a window a
 *  reader has to scroll. Anything past it is counted, not listed. */
export const PER_CATEGORY = 40

/**
 * How many of a category the window shows before the rest are folded away
 * behind "Show N more".
 *
 * Ten is what a reader can take in without the first category pushing the
 * seventh off the bottom of a window they have to scroll. This is a FOLD, not a
 * shorter list: the items behind it are read, counted and one click away, and
 * the emailed digest carries all of them because an inbox has no disclosure to
 * open. The heading count is the real total either way.
 */
export const PREVIEW_PER_CATEGORY = 10

/**
 * The categories, in the order they are shown.
 *
 * `tldr: true` marks the two the reader was promised a summary for — brand new
 * research and news. The rest are records, not stories: a device clearance or a
 * patent says what it is in its own title, and a two-sentence gloss on it would
 * be padding written from the same fields already on the row.
 *
 * FOUR CATEGORIES, AND THE OMISSIONS ARE THE DESIGN. Companies and labs, new
 * clinical trials, devices and clearances, and patents were each on this list
 * and each came off it, for one reason in two forms.
 *
 * Three of them are the index NOTICING something rather than something
 * happening. A new organization row is minted the first time a name turns up as
 * a paper affiliation, a device manufacturer or a trial sponsor, so the section
 * filled with companies that had done nothing that day. Devices and patents
 * arrive in periodic backfills — a openFDA or PatentsView sweep drops hundreds
 * of records at once, dated to when the sweep ran and not to when anything
 * happened — so the category was silent for weeks and then enormous, and neither
 * state told a reader anything about that day.
 *
 * New trials are the fourth, and the reason is sharper. A registration is a
 * one-time event, and it is the trial's STATUS that keeps moving afterwards:
 * opening, closing, changing phase, resizing. `trialChanges` is that movement,
 * and it is what a reader following the field actually wants. Listing both put
 * the same studies in the window twice under two headings.
 *
 * What is left is four things that are dated because they happened: a paper, a
 * story, a trial that moved, a company that raised money above
 * FUNDING_FLOOR_USD.
 */
export const CATEGORIES = [
  { key: 'research', label: 'Research', tldr: true },
  { key: 'news', label: 'News', tldr: true },
  { key: 'trialChanges', label: 'Clinical trial changes', tldr: false },
  { key: 'funding', label: 'Funding rounds', tldr: false },
]

/**
 * The smallest raise that puts a company on this list.
 *
 * Companies came off the list because being newly indexed says nothing; the
 * agreed exception is a company that raises a big sum, so the floor is what
 * "big" means here. $1M keeps every real institutional round — a neurotech seed
 * is $2M to $5M — and drops micro-grants and angel cheques.
 *
 * A round with no `amount_usd` is dropped too. The carve-out is about the size
 * of the raise, and an undisclosed figure cannot be shown to clear a floor;
 * listing it anyway would put a company back on the list on the strength of a
 * number nobody has. It stays visible on the company's own page either way.
 */
export const FUNDING_FLOOR_USD = 1_000_000

/** The UTC day `now` falls in, and the half-open window that selects it. */
export function dayWindow(now = new Date()) {
  const day = new Date(now).toISOString().slice(0, 10)
  return { day, startISO: `${day}T00:00:00.000Z`, endISO: `${day}T23:59:59.999Z` }
}

/** 24 August 2026, for a heading and an email subject line. */
export function formatDay(day) {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim()

/**
 * The first two sentences of the best text the record carries.
 *
 * Sentence splitting is deliberately blunt — a full stop, question or
 * exclamation mark followed by a space and a capital — because the alternative
 * is a parser that has to know about "et al.", "Fig. 2", "U.S." and "vs.". A
 * blunt splitter that occasionally keeps one sentence too few beats one that
 * cuts "Dr." in half, and the character cap catches anything it runs past.
 */
export function tldr(text, { sentences = 2, maxChars = 300 } = {}) {
  const s = clean(text)
  if (!s) return null

  const parts = []
  let rest = s
  while (parts.length < sentences && rest) {
    const m = rest.match(/^(.*?[.!?])(\s+[A-Z0-9"'(]|$)/s)
    if (!m) { parts.push(rest); break }
    parts.push(m[1])
    rest = rest.slice(m[1].length).trim()
  }

  let out = parts.join(' ').trim()
  if (out.length > maxChars) {
    // Cut on a word, and mark the cut. A summary that stops mid-word reads as
    // a bug rather than as a summary.
    out = out.slice(0, maxChars).replace(/\s+\S*$/, '').replace(/[,;:.]+$/, '') + '…'
  }
  return out || null
}

/** The TLDR for a feed row, from the richest field the pipeline wrote for it. */
export const tldrOf = row =>
  tldr(row?.metadata?.significance) || tldr(row?.summary) || tldr(row?.metadata?.abstract) || null

/**
 * "Chen Wang et al." — the first author, and an honest marker that there are
 * more.
 *
 * A research row's author list runs to thirty names and would swamp the title it
 * sits under, and the first author is the one a reader recognises and searches
 * on. "et al." is appended whenever a second author exists, including at exactly
 * two: the alternative is naming both, which sets a rule the list breaks again
 * at three, and the point of the line is to attribute the work, not to be the
 * citation. The full list is on the item page.
 *
 * Ingestion writes whole names ("Chen Wang", not "Wang C"), from PubMed's
 * ForeName plus LastName and from arXiv's author elements, so there is no
 * surname to reconstruct here. Absent or empty lists give null, which renders as
 * nothing rather than as an empty byline.
 */
export function byline(authors) {
  const list = (Array.isArray(authors) ? authors : authors ? [authors] : [])
    .map(clean).filter(Boolean)
  if (!list.length) return null
  return list.length > 1 ? `${list[0]} et al.` : list[0]
}

/** The byline for a feed row, from the author list ingestion stored on it. */
export const bylineOf = row => byline(row?.metadata?.authors)

const money = n => {
  if (!Number.isFinite(n)) return null
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${n}`
}

// ── Row → entry ─────────────────────────────────────────────────────────────
//
// One shape for every category, so the window and the email each render one
// kind of thing: a title, a link on the site where there is a page for it, the
// outbound source, a byline where the record has authors, a line of context, and
// a TLDR where the category has one.

const entry = (o) => ({ tldr: null, href: null, url: null, meta: null, byline: null, ...o })

/**
 * `withByline` is research and only research. News rows carry a publication in
 * `source`, not an author list, and a wire story credited to one named reporter
 * as "Name et al." would be wrong twice over.
 */
export const fromFeedRow = (row, { withTldr = false, withByline = false } = {}) => entry({
  id: row.id,
  title: clean(row.title),
  href: `/item/${row.id}`,
  url: row.url || null,
  meta: [row.source, row.metadata?.phase, row.metadata?.status].filter(Boolean).join(' · ') || null,
  byline: withByline ? bylineOf(row) : null,
  tldr: withTldr ? tldrOf(row) : null,
})

/** "Recruiting" out of "recruiting", as the trials page prints it. */
const prettyStatus = s => clean(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
const changeValue = (field, v) => (field === 'status' ? prettyStatus(String(v || '').replace(/_/g, ' ')) : clean(v)) || 'none'

/** "status: Recruiting to Active Not Recruiting" — one moved field. */
export const changeLine = c => `${clean(c.field)}: ${changeValue(c.field, c.old_value)} to ${changeValue(c.field, c.new_value)}`

/**
 * One trial that moved today, not one row per field that moved.
 *
 * trial_changes is one row per field, and a study that closes writes status and
 * enrollment together, so a raw list prints the same trial twice under two
 * different half-sentences. groupTrialChanges stacks a trial's changes under its
 * own title; this turns that group into an entry, with every change it carries
 * on the context line (at most three: status, phase and enrollment are all that
 * scripts/trials.js tracks).
 */
export const fromTrialChangeGroup = (group) => entry({
  id: group.key,
  title: clean(group.title),
  href: group.itemId ? `/item/${group.itemId}` : null,
  url: group.url || null,
  meta: group.changes.map(changeLine).join(' · ') || null,
})

export const fromFundingRound = (row, org) => entry({
  id: row.id,
  title: org ? clean(org.display_name || org.name) : 'Undisclosed company',
  href: org ? `/company/${org.id}` : null,
  url: row.source_url || null,
  meta: [money(row.amount_usd), row.round_date].filter(Boolean).join(' · ') || null,
})

/**
 * Read everything created on `day`, in one shape.
 *
 * `client` is a supabase-js client — anon in the browser, service-role in the
 * daily run. Every read is a plain `created_at` window: the question is "what
 * did the index gain today", and created_at is when the index gained it.
 * published_at would answer a different question (a paper published in June and
 * ingested this morning is new to this index today, and is exactly what a
 * reader opening this window wants to see).
 *
 * A category that errors comes back empty rather than taking the window down
 * with it, the same bargain every other read on the site makes.
 */
export async function fetchWhatsNew(client, { now = new Date(), perCategory = PER_CATEGORY } = {}) {
  const { day, startISO, endISO } = dayWindow(now)
  const empty = { day, sections: CATEGORIES.map(c => ({ ...c, items: [], total: 0 })), total: 0 }
  if (!client) return empty

  const window_ = q => q.gte('created_at', startISO).lte('created_at', endISO)
  const rows = async (q) => {
    const { data, error } = await q
    if (error) { console.warn('what\'s new read failed:', error.message); return [] }
    return data || []
  }
  const feed = types => rows(window_(client.from('news_feed').select('*').in('entry_type', types))
    .order('created_at', { ascending: false }).limit(perCategory))

  const [research, news, trialChanges, funding] = await Promise.all([
    feed(['paper', 'preprint']),
    feed(['news']),
    // Read more change rows than the category will show: they group down to one
    // entry per trial, and a study that closes writes three of them at once.
    rows(window_(client.from('trial_changes').select('id,nct_id,trial_id,field,old_value,new_value,changed_at,created_at'))
      .order('created_at', { ascending: false }).limit(perCategory * 3)),
    // A company earns its line by the size of the raise, not by existing, so the
    // floor goes in the query rather than after it: filtering the page would let
    // small rounds use up the cap and push big ones off a backfill day. `gte`
    // drops a null amount too, which is the intended reading — see
    // FUNDING_FLOOR_USD.
    rows(window_(client.from('funding_rounds').select('id,organization_id,amount_usd,round_date,source_url,created_at'))
      .gte('amount_usd', FUNDING_FLOOR_USD)
      .order('created_at', { ascending: false }).limit(perCategory)),
  ])

  // Funding rounds name a company id and nothing else; resolve them in one
  // read so a round can say who raised it.
  let orgById = {}
  const orgIds = [...new Set(funding.map(r => r.organization_id).filter(Boolean))]
  if (orgIds.length) {
    const named = await rows(client.from('organizations').select('id,name,display_name').in('id', orgIds))
    orgById = Object.fromEntries(named.map(o => [o.id, o]))
  }

  // A change row names a trial by id; the trial's own title lives in news_feed.
  // A change whose trial has left the index (a purge, a re-ingest) is dropped:
  // it has no title to print and nowhere to link, so it can only render as a
  // bare NCT number in a list of named studies. getRecentTrialChanges in
  // data.js drops them for the same reason.
  let trialById = {}
  const trialIds = [...new Set(trialChanges.map(c => c.trial_id).filter(Boolean))]
  if (trialIds.length) {
    const named = await rows(client.from('news_feed').select('id,title,url').in('id', trialIds))
    trialById = Object.fromEntries(named.map(t => [t.id, t]))
  }
  const namedChanges = trialChanges
    .filter(c => trialById[c.trial_id])
    .map(c => ({ ...c, itemId: c.trial_id, title: trialById[c.trial_id].title, url: trialById[c.trial_id].url }))

  const byKey = {
    research: research.map(r => fromFeedRow(r, { withTldr: true, withByline: true })),
    news: news.map(r => fromFeedRow(r, { withTldr: true })),
    trialChanges: groupTrialChanges(namedChanges, perCategory).map(fromTrialChangeGroup),
    funding: funding.map(r => fromFundingRound(r, orgById[r.organization_id])),
  }

  const sections = CATEGORIES.map(c => ({ ...c, items: byKey[c.key] || [], total: (byKey[c.key] || []).length }))
  return { day, sections, total: sections.reduce((n, s) => n + s.total, 0) }
}

/** Only the sections that have something in them. */
export const filledSections = digest => (digest?.sections || []).filter(s => s.items.length)

// ── The email ───────────────────────────────────────────────────────────────
//
// Rendered here rather than in the send script so the digest that lands in an
// inbox is the window, in the same order, with the same TLDRs. `origin` is the
// site's public URL: an email cannot follow a relative href.

export const digestSubject = digest =>
  `NeuroBase: what's new on ${formatDay(digest.day)} (${digest.total} new item${digest.total === 1 ? '' : 's'})`

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const linkFor = (item, origin) => (item.href ? `${origin}${item.href}` : item.url) || null

/**
 * How a reader gets off the list, in one line at the bottom of every send.
 *
 * Bulk mail carries an opt-out. There is no server here to host a one-click
 * unsubscribe endpoint and the anon key cannot update the table (migration 025
 * grants insert and nothing else), so until something can, the opt-out is a
 * reply to the address the digest was sent from — a real route a person can
 * use, which is the part that matters, rather than a link that would need
 * infrastructure that does not exist. `unsubscribeUrl` is the seam for that
 * endpoint when there is one; it wins over the mailto when both are given.
 */
export function unsubscribeLine({ unsubscribeUrl = null, replyTo = null } = {}) {
  if (unsubscribeUrl) return { href: unsubscribeUrl, label: 'Unsubscribe', how: 'Unsubscribe' }
  if (replyTo) {
    return {
      href: `mailto:${replyTo}?subject=${encodeURIComponent('Unsubscribe')}`,
      label: 'Reply with "unsubscribe"',
      how: `To stop these, reply to ${replyTo} with "unsubscribe".`,
    }
  }
  return null
}

export function digestHtml(digest, { origin = 'https://neurobase-live.vercel.app', unsubscribeUrl = null, replyTo = null } = {}) {
  const sections = filledSections(digest).map(s => {
    const items = s.items.map(it => {
      const href = linkFor(it, origin)
      const title = href
        ? `<a href="${esc(href)}" style="color:#0B5FA6;text-decoration:none">${esc(it.title)}</a>`
        : esc(it.title)
      const by = it.byline ? `<div style="font:12px/1.5 Arial,sans-serif;color:#3D424D">${esc(it.byline)}</div>` : ''
      const meta = it.meta ? `<div style="font:12px/1.5 Arial,sans-serif;color:#6B7280">${esc(it.meta)}</div>` : ''
      const sum = it.tldr ? `<div style="font:14px/1.6 Georgia,serif;color:#3D424D;margin-top:4px">${esc(it.tldr)}</div>` : ''
      return `<li style="margin:0 0 14px 0"><div style="font:600 15px/1.4 Georgia,serif">${title}</div>${by}${meta}${sum}</li>`
    }).join('')
    return `<h2 style="font:600 13px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#16181D;border-bottom:1px solid #E4E2DC;padding-bottom:6px;margin:28px 0 14px">${esc(s.label)} <span style="color:#6B7280">(${s.items.length})</span></h2><ul style="list-style:none;padding:0;margin:0">${items}</ul>`
  }).join('')

  const out = unsubscribeLine({ unsubscribeUrl, replyTo })
  const foot = out
    ? `<p style="font:12px/1.5 Arial,sans-serif;color:#6B7280;margin-top:28px">You are receiving this because you asked for the daily digest on NeuroBase. <a href="${esc(out.href)}" style="color:#6B7280">${esc(out.label)}</a>.</p>`
    : ''

  return `<div style="max-width:640px;margin:0 auto;padding:24px;background:#FFFFFF">
<h1 style="font:600 26px/1.2 Georgia,serif;color:#16181D;margin:0">What's new today</h1>
<p style="font:14px/1.5 Arial,sans-serif;color:#6B7280;margin:6px 0 0">${esc(formatDay(digest.day))} · ${digest.total} new item${digest.total === 1 ? '' : 's'} · <a href="${esc(origin)}" style="color:#0B5FA6;text-decoration:none">NeuroBase</a></p>
${sections || '<p style="font:15px/1.6 Georgia,serif;color:#3D424D">Nothing new landed today.</p>'}
${foot}
</div>`
}

export function digestText(digest, { origin = 'https://neurobase-live.vercel.app', unsubscribeUrl = null, replyTo = null } = {}) {
  const lines = [`What's new today — ${formatDay(digest.day)} (${digest.total} new)`, '']
  for (const s of filledSections(digest)) {
    lines.push(`${s.label.toUpperCase()} (${s.items.length})`)
    for (const it of s.items) {
      lines.push(`- ${it.title}`)
      if (it.byline) lines.push(`  ${it.byline}`)
      if (it.meta) lines.push(`  ${it.meta}`)
      if (it.tldr) lines.push(`  ${it.tldr}`)
      const href = linkFor(it, origin)
      if (href) lines.push(`  ${href}`)
    }
    lines.push('')
  }
  if (!filledSections(digest).length) lines.push('Nothing new landed today.')
  const out = unsubscribeLine({ unsubscribeUrl, replyTo })
  if (out) lines.push('', out.how)
  return lines.join('\n')
}

// ── Subscribers ─────────────────────────────────────────────────────────────

/** Deliberately permissive: one @, a dot in the domain, no spaces. The address
 *  is proved by the mail arriving, not by a regex. */
export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim())

export const SUBSCRIBERS_TABLE = 'digest_subscribers'

/**
 * Record an address for the daily digest.
 *
 * Insert-only by design: the anon key may add a row and may not read the table
 * back (see supabase/migrations/025-digest-subscribers.sql), so a stranger
 * cannot enumerate who is subscribed. A duplicate address is a success, not an
 * error — the reader asked to be on the list and they are on the list.
 */
export async function subscribe(client, email) {
  const address = String(email || '').trim().toLowerCase()
  if (!isEmail(address)) return { ok: false, error: 'That does not look like an email address.' }
  if (!client) return { ok: false, error: 'Subscriptions are unavailable right now.' }

  const { error } = await client.from(SUBSCRIBERS_TABLE).insert({ email: address })
  if (error) {
    if (error.code === '23505') return { ok: true, already: true }
    console.warn('subscribe failed:', error.message)
    return { ok: false, error: 'Could not save that address. Please try again later.' }
  }
  return { ok: true, already: false }
}
