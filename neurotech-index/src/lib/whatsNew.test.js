import { describe, it, expect } from 'vitest'
import {
  CATEGORIES, FUNDING_FLOOR_USD, dayWindow, formatDay, tldr, tldrOf, byline, bylineOf,
  fromFeedRow, fromDevice, fromPatent, fromTrialChangeGroup, changeLine,
  fromFundingRound, fetchWhatsNew, filledSections, digestSubject,
  digestHtml, digestText, isEmail, subscribe, unsubscribeLine,
} from './whatsNew'

// A supabase-js stand-in: every builder method returns the chain, and awaiting
// the chain yields whatever the table was seeded with. It records the filters
// it was given so the window itself can be asserted.
function stubClient(tables = {}, { failing = [] } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, filters: {} }
      calls.push(call)
      const chain = {
        select() { return chain },
        in(col, vals) { call.filters[col] = vals; return chain },
        // A query can carry more than one gte (the day window, plus the funding
        // floor). `gte` stays the first — the day window, applied first
        // everywhere — and `gtes` keeps them all.
        gte(col, v) { (call.filters.gtes ||= []).push([col, v]); call.filters.gte ||= [col, v]; return chain },
        lte(col, v) { call.filters.lte = [col, v]; return chain },
        order() { return chain },
        limit(n) { call.filters.limit = n; return chain },
        insert(row) { call.insert = row; return chain },
        then(resolve) {
          resolve(failing.includes(table)
            ? { data: null, error: { message: 'boom' } }
            : { data: tables[table] || [], error: null })
        },
      }
      return chain
    },
  }
}

const feedRow = (over = {}) => ({
  id: over.id || 'f1',
  title: 'A cortical implant restores touch',
  summary: 'One crisp line about why it matters.',
  source: 'Nature',
  url: 'https://example.org/a',
  entry_type: 'paper',
  metadata: {},
  created_at: '2026-08-24T07:10:00Z',
  ...over,
})

describe('dayWindow', () => {
  it('is the UTC calendar day, as a half-open pair the query can use', () => {
    const w = dayWindow(new Date('2026-08-24T07:23:00Z'))
    expect(w).toEqual({
      day: '2026-08-24',
      startISO: '2026-08-24T00:00:00.000Z',
      endISO: '2026-08-24T23:59:59.999Z',
    })
  })

  it('does not slide to the previous day for a reader west of Greenwich', () => {
    // 02:23 in Chicago on the 24th is 07:23 UTC on the 24th: same day, and the
    // window has to agree with the cron that stamped the rows.
    expect(dayWindow(new Date('2026-08-24T07:23:00Z')).day).toBe('2026-08-24')
  })

  it('formats the day for a heading', () => {
    expect(formatDay('2026-08-24')).toBe('24 August 2026')
  })
})

describe('tldr', () => {
  it('takes the first two sentences', () => {
    const t = tldr('First one here. Second one here. Third one should be dropped.')
    expect(t).toBe('First one here. Second one here.')
  })

  it('keeps a single sentence whole when that is all there is', () => {
    expect(tldr('Only the one sentence.')).toBe('Only the one sentence.')
  })

  it('does not split on a lower-case continuation after a full stop', () => {
    // "et al." and "vs." are the common case; the splitter needs a capital
    // after the space before it will call it a sentence break.
    expect(tldr('Chen et al. report a decoder. It ran for six months. And more.'))
      .toBe('Chen et al. report a decoder. It ran for six months.')
  })

  it('cuts on a word boundary and marks the cut', () => {
    const long = `${'word '.repeat(80)}end.`
    const t = tldr(long, { maxChars: 40 })
    expect(t.length).toBeLessThanOrEqual(41)
    expect(t.endsWith('…')).toBe(true)
    expect(t).not.toMatch(/wor…$/)
  })

  it('collapses whitespace and returns null for nothing', () => {
    expect(tldr('  a   b.  ')).toBe('a b.')
    expect(tldr('')).toBe(null)
    expect(tldr(null)).toBe(null)
  })
})

describe('tldrOf', () => {
  it('prefers the significance paragraph, then the summary, then the abstract', () => {
    const sig = feedRow({ summary: 'Summary line.', metadata: { significance: 'Sig one. Sig two. Sig three.', abstract: 'Abs.' } })
    expect(tldrOf(sig)).toBe('Sig one. Sig two.')
    expect(tldrOf(feedRow({ metadata: { abstract: 'Abs one. Abs two.' } }))).toBe('One crisp line about why it matters.')
    expect(tldrOf(feedRow({ summary: '', metadata: { abstract: 'Abs one. Abs two. Abs three.' } }))).toBe('Abs one. Abs two.')
    expect(tldrOf(feedRow({ summary: '', metadata: {} }))).toBe(null)
  })
})

describe('byline', () => {
  it('names the first author and marks that there are more', () => {
    expect(byline(['Chen Wang', 'Ana Ruiz', 'John Smith'])).toBe('Chen Wang et al.')
  })

  it('says "et al." at exactly two authors rather than naming both', () => {
    expect(byline(['Chen Wang', 'Ana Ruiz'])).toBe('Chen Wang et al.')
  })

  it('leaves a sole author standing alone', () => {
    expect(byline(['Chen Wang'])).toBe('Chen Wang')
  })

  it('is null when there is nobody to credit', () => {
    expect(byline([])).toBe(null)
    expect(byline(null)).toBe(null)
    expect(byline(['', '  '])).toBe(null)
    expect(bylineOf(feedRow({ metadata: {} }))).toBe(null)
    expect(bylineOf(undefined)).toBe(null)
  })

  it('accepts a bare string as one author, and tidies whitespace', () => {
    expect(byline('  Chen   Wang ')).toBe('Chen Wang')
    expect(bylineOf(feedRow({ metadata: { authors: ['Chen  Wang', 'Ana Ruiz'] } }))).toBe('Chen Wang et al.')
  })
})

describe('row mappers', () => {
  it('links a feed row to its item page and carries the outbound url', () => {
    const e = fromFeedRow(feedRow({ id: 'abc' }), { withTldr: true })
    expect(e.href).toBe('/item/abc')
    expect(e.url).toBe('https://example.org/a')
    expect(e.tldr).toBe('One crisp line about why it matters.')
  })

  it('leaves the TLDR off the categories that were not promised one', () => {
    expect(fromFeedRow(feedRow()).tldr).toBe(null)
  })

  it('puts a byline on research and on nothing else', () => {
    const row = feedRow({ metadata: { authors: ['Chen Wang', 'Ana Ruiz'] } })
    expect(fromFeedRow(row, { withTldr: true, withByline: true }).byline).toBe('Chen Wang et al.')
    // News carries a publication in `source`, not an author list.
    expect(fromFeedRow(row, { withTldr: true }).byline).toBe(null)
    expect(fromFeedRow(row).byline).toBe(null)
  })

  it('names a trial with its phase and status', () => {
    const e = fromFeedRow(feedRow({ entry_type: 'trial', source: 'ClinicalTrials.gov', metadata: { phase: 'Phase 2', status: 'Recruiting' } }))
    expect(e.meta).toBe('ClinicalTrials.gov · Phase 2 · Recruiting')
  })

  it('links devices to their own pages, and patents out', () => {
    expect(fromDevice({ id: 'd1', name: 'Array', manufacturer: 'Acme', status: 'Cleared' }).href).toBe('/device/d1')
    const p = fromPatent({ id: 'p1', title: 'Electrode', assignee: 'Acme', patent_number: 'US1', url: 'https://patents/1' })
    expect(p.href).toBe(null)
    expect(p.url).toBe('https://patents/1')
  })

  it('spells out a trial change from and to, and tidies the stored status', () => {
    expect(changeLine({ field: 'status', old_value: 'recruiting', new_value: 'active_not_recruiting' }))
      .toBe('status: Recruiting to Active Not Recruiting')
    expect(changeLine({ field: 'enrollment', old_value: null, new_value: '48' }))
      .toBe('enrollment: none to 48')
  })

  it('gives one entry per changed trial, with every field it moved', () => {
    const e = fromTrialChangeGroup({
      key: 't1',
      title: 'A trial of a cortical implant',
      itemId: 't1',
      changes: [
        { id: 'c1', field: 'status', old_value: 'recruiting', new_value: 'completed' },
        { id: 'c2', field: 'enrollment', old_value: '40', new_value: '48' },
      ],
    })
    expect(e.title).toBe('A trial of a cortical implant')
    expect(e.href).toBe('/item/t1')
    expect(e.meta).toBe('status: Recruiting to Completed · enrollment: 40 to 48')
    expect(e.tldr).toBe(null)
  })

  it('gives a funding round the company that raised it, and a readable amount', () => {
    const e = fromFundingRound(
      { id: 'r1', organization_id: 'o1', amount_usd: 42_000_000, round_date: '2026-08-24' },
      { id: 'o1', name: 'Acme Neuro' },
    )
    expect(e.title).toBe('Acme Neuro')
    expect(e.href).toBe('/company/o1')
    expect(e.meta).toBe('$42M · 2026-08-24')
  })

  it('does not invent a company for an unresolved round', () => {
    const e = fromFundingRound({ id: 'r1', amount_usd: 1_500_000_000 }, null)
    expect(e.title).toBe('Undisclosed company')
    expect(e.href).toBe(null)
    expect(e.meta).toBe('$1.5B')
  })
})

describe('fetchWhatsNew', () => {
  const client = () => stubClient({
    news_feed: [feedRow({ id: 'n1', metadata: { authors: ['Chen Wang', 'Ana Ruiz'] } })],
    trial_changes: [{ id: 'c1', nct_id: 'NCT1', trial_id: 'n1', field: 'status', old_value: 'recruiting', new_value: 'completed' }],
    devices: [{ id: 'd1', name: 'Array', manufacturer: 'Acme' }],
    patents: [{ id: 'p1', title: 'Electrode', url: 'https://patents/1' }],
    organizations: [{ id: 'o1', name: 'Acme', type: 'company' }],
    funding_rounds: [{ id: 'r1', organization_id: 'o1', amount_usd: 5e6 }],
  })

  it('reads every category inside today\'s UTC window', async () => {
    const c = client()
    const digest = await fetchWhatsNew(c, { now: new Date('2026-08-24T09:00:00Z') })
    expect(digest.day).toBe('2026-08-24')
    // news_feed is asked three times (research, news, trials), plus four tables:
    // trial_changes, devices, patents, funding_rounds.
    const windowed = c.calls.filter(x => x.filters.gte)
    expect(windowed.length).toBe(7)
    for (const call of windowed) {
      expect(call.filters.gte).toEqual(['created_at', '2026-08-24T00:00:00.000Z'])
      expect(call.filters.lte).toEqual(['created_at', '2026-08-24T23:59:59.999Z'])
    }
    // Organizations are read only to name the companies behind funding rounds,
    // and that read is not windowed: a company indexed last year can raise today.
    const orgReads = c.calls.filter(x => x.table === 'organizations')
    expect(orgReads).toHaveLength(1)
    expect(orgReads[0].filters.gte).toBeUndefined()
  })

  it('keeps the category order and counts the total', async () => {
    const digest = await fetchWhatsNew(client(), { now: new Date('2026-08-24T09:00:00Z') })
    expect(digest.sections.map(s => s.key)).toEqual(CATEGORIES.map(c => c.key))
    expect(digest.sections.map(s => s.key)).not.toContain('organizations')
    // one feed row per feed category (3) + trial change + device + patent + round
    expect(digest.total).toBe(7)
    expect(digest.sections.find(s => s.key === 'research').items[0].tldr).toBeTruthy()
    expect(digest.sections.find(s => s.key === 'research').items[0].byline).toBe('Chen Wang et al.')
    expect(digest.sections.find(s => s.key === 'trials').items[0].tldr).toBe(null)
    expect(digest.sections.find(s => s.key === 'trials').items[0].byline).toBe(null)
  })

  it('lists a changed trial once, under its own title', async () => {
    const c = stubClient({
      news_feed: [feedRow({ id: 't1', title: 'A trial of a cortical implant', entry_type: 'trial' })],
      trial_changes: [
        { id: 'c1', nct_id: 'NCT1', trial_id: 't1', field: 'status', old_value: 'recruiting', new_value: 'completed' },
        { id: 'c2', nct_id: 'NCT1', trial_id: 't1', field: 'enrollment', old_value: '40', new_value: '48' },
      ],
    })
    const items = (await fetchWhatsNew(c, { now: new Date('2026-08-24T09:00:00Z') }))
      .sections.find(s => s.key === 'trialChanges').items
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('A trial of a cortical implant')
    expect(items[0].href).toBe('/item/t1')
    expect(items[0].meta).toBe('status: Recruiting to Completed · enrollment: 40 to 48')
  })

  it('drops a change whose trial has left the index', async () => {
    // Nothing to name it with and nowhere to link: it could only render as a
    // bare NCT number in a list of named studies.
    const c = stubClient({
      news_feed: [],
      trial_changes: [{ id: 'c1', nct_id: 'NCT9', trial_id: 'gone', field: 'status', old_value: 'recruiting', new_value: 'terminated' }],
    })
    const digest = await fetchWhatsNew(c, { now: new Date('2026-08-24T09:00:00Z') })
    expect(digest.sections.find(s => s.key === 'trialChanges').items).toEqual([])
  })

  it('asks only for rounds big enough to put a company back on the list', async () => {
    // The floor is in the QUERY, not applied to the page it returns: a day of
    // small rounds must not use up the cap and push the big ones off it. gte on
    // a nullable column drops the undisclosed amounts along with the small ones,
    // which is the intended reading.
    const c = client()
    await fetchWhatsNew(c, { now: new Date('2026-08-24T09:00:00Z') })
    const round = c.calls.find(x => x.table === 'funding_rounds')
    expect(round.filters.gtes).toContainEqual(['amount_usd', FUNDING_FLOOR_USD])
    expect(round.filters.limit).toBe(40)
    // Every other windowed read asks for the day and nothing more.
    const trials = c.calls.find(x => x.table === 'trial_changes')
    expect(trials.filters.gtes).toHaveLength(1)
  })

  it('survives one category failing', async () => {
    const c = stubClient({ devices: [{ id: 'd1', name: 'Array' }] }, { failing: ['news_feed'] })
    const digest = await fetchWhatsNew(c, { now: new Date('2026-08-24T09:00:00Z') })
    expect(digest.sections.find(s => s.key === 'research').items).toEqual([])
    expect(digest.sections.find(s => s.key === 'devices').items).toHaveLength(1)
  })

  it('returns an empty day rather than throwing with no client', async () => {
    const digest = await fetchWhatsNew(null, { now: new Date('2026-08-24T09:00:00Z') })
    expect(digest.total).toBe(0)
    expect(filledSections(digest)).toEqual([])
  })
})

describe('the email', () => {
  const digest = {
    day: '2026-08-24',
    total: 2,
    sections: [
      { key: 'research', label: 'Research', items: [{ id: 'a', title: 'Implant & array', href: '/item/a', byline: 'Chen Wang et al.', meta: 'Nature', tldr: 'Two sentences. Right here.' }] },
      { key: 'news', label: 'News', items: [] },
      { key: 'patents', label: 'Patents', items: [{ id: 'p', title: 'Electrode', url: 'https://patents/1', meta: 'Acme', tldr: null }] },
    ],
  }

  it('names the day and the count in the subject', () => {
    expect(digestSubject(digest)).toBe("NeuroBase: what's new on 24 August 2026 (2 new items)")
    expect(digestSubject({ ...digest, total: 1 })).toMatch(/\(1 new item\)$/)
  })

  it('drops empty sections and makes site links absolute', () => {
    const html = digestHtml(digest, { origin: 'https://neurobase-live.vercel.app' })
    expect(html).toContain('https://neurobase-live.vercel.app/item/a')
    expect(html).toContain('https://patents/1')
    expect(html).not.toContain('>News <')
    expect(html).toContain('Two sentences. Right here.')
  })

  it('escapes what the pipeline ingested', () => {
    const html = digestHtml({ day: '2026-08-24', total: 1, sections: [{ key: 'news', label: 'News', items: [{ id: 'x', title: '<script>alert(1)</script>', href: '/item/x' }] }] })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders a plain-text twin', () => {
    const text = digestText(digest, { origin: 'https://n.b' })
    expect(text).toContain('RESEARCH (1)')
    expect(text).toContain('https://n.b/item/a')
    expect(text).not.toContain('NEWS (0)')
  })

  it('carries the byline into both renderings, the same as the window', () => {
    expect(digestHtml(digest)).toContain('Chen Wang et al.')
    expect(digestText(digest)).toContain('Chen Wang et al.')
    // The patent has no byline, and gets no blank line standing in for one.
    expect(digestText(digest)).toContain('- Electrode\n  Acme\n  https://patents/1')
  })

  it('says so when the day was empty', () => {
    expect(digestText({ day: '2026-08-24', total: 0, sections: [] })).toContain('Nothing new landed today.')
  })

  it('carries an opt-out: the endpoint when there is one, a reply when there is not', () => {
    expect(unsubscribeLine({ unsubscribeUrl: 'https://n.b/unsub' }).href).toBe('https://n.b/unsub')
    const mail = unsubscribeLine({ replyTo: 'digest@n.b' })
    expect(mail.href).toBe('mailto:digest@n.b?subject=Unsubscribe')
    expect(mail.how).toContain('reply to digest@n.b')
    // An endpoint beats a reply when both are given.
    expect(unsubscribeLine({ unsubscribeUrl: 'https://n.b/unsub', replyTo: 'digest@n.b' }).href).toBe('https://n.b/unsub')
    expect(unsubscribeLine({})).toBe(null)
  })

  it('puts the opt-out in both renderings', () => {
    expect(digestHtml(digest, { replyTo: 'digest@n.b' })).toContain('mailto:digest@n.b')
    expect(digestText(digest, { replyTo: 'digest@n.b' })).toContain('reply to digest@n.b with "unsubscribe"')
    // No route to offer, no promise made.
    expect(digestHtml(digest)).not.toContain('You are receiving this')
  })
})

describe('subscribe', () => {
  it('accepts an ordinary address and rejects the rest', () => {
    expect(isEmail('a@b.co')).toBe(true)
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('a b@c.com')).toBe(false)
    expect(isEmail('')).toBe(false)
  })

  it('lower-cases and trims before inserting', async () => {
    const c = stubClient()
    const r = await subscribe(c, '  Reader@Example.COM ')
    expect(r.ok).toBe(true)
    expect(c.calls.at(-1).insert).toEqual({ email: 'reader@example.com' })
  })

  it('treats an address already on the list as success', async () => {
    const c = {
      from: () => ({ insert: () => ({ then: r => r({ error: { code: '23505', message: 'duplicate' } }) }) }),
    }
    expect(await subscribe(c, 'reader@example.com')).toEqual({ ok: true, already: true })
  })

  it('refuses a malformed address without touching the network', async () => {
    const c = stubClient()
    const r = await subscribe(c, 'nope')
    expect(r.ok).toBe(false)
    expect(c.calls).toHaveLength(0)
  })
})
