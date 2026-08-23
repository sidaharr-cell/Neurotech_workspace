import { describe, it, expect } from 'vitest'
import {
  EMPTY, keyOf, ownerOf, isFree, imageFor, bind,
  leadOn, lastLead, recentLeadIds, recordLead, chooseLead, LEAD_MEMORY_DAYS,
} from './ledger'

const COMMONS_1280 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/EEG_cap.jpg/1280px-EEG_cap.jpg'
const COMMONS_2000 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/EEG_cap.jpg/2000px-EEG_cap.jpg'
const COMMONS_FULL = 'https://upload.wikimedia.org/wikipedia/commons/8/86/EEG_cap.jpg'

describe('the key a picture is remembered under', () => {
  it('ignores scheme, www and a trailing slash', () => {
    expect(keyOf('http://www.example.com/a.jpg/')).toBe(keyOf('https://example.com/a.jpg'))
  })

  it('ignores the query string publishers append to their own images', () => {
    expect(keyOf('https://cdn.site.com/a.jpg?w=800&auto=format')).toBe(keyOf('https://cdn.site.com/a.jpg'))
  })

  // The one that matters: raising the resolution floor re-sources every
  // Wikimedia picture at a larger thumbnail width. If the width were part of
  // the key, every spent photograph would come back into the pool that night
  // and start appearing beside second stories.
  it('collapses Wikimedia thumbnail widths onto the file itself', () => {
    expect(keyOf(COMMONS_2000)).toBe(keyOf(COMMONS_1280))
    expect(keyOf(COMMONS_FULL)).toBe(keyOf(COMMONS_1280))
  })

  it('does not collapse two different files that share a width', () => {
    const other = COMMONS_1280.replace(/EEG_cap/g, 'MEG_room')
    expect(keyOf(other)).not.toBe(keyOf(COMMONS_1280))
  })
})

describe('one photograph, one story', () => {
  const held = bind(EMPTY, COMMONS_1280, { item: 'story-a', title: 'A', at: '2026-08-20' })

  it('answers who holds a picture', () => {
    expect(ownerOf(held, COMMONS_1280)).toBe('story-a')
    expect(ownerOf(held, 'https://example.com/loose.jpg')).toBe(null)
  })

  it('leaves an unbound picture free for anyone', () => {
    expect(isFree(held, 'https://example.com/loose.jpg', 'story-b')).toBe(true)
  })

  it('keeps a bound picture free for the story that holds it', () => {
    expect(isFree(held, COMMONS_1280, 'story-a')).toBe(true)
  })

  it('refuses a bound picture to every other story, at any later date', () => {
    expect(isFree(held, COMMONS_1280, 'story-b')).toBe(false)
    expect(isFree(held, COMMONS_2000, 'story-b')).toBe(false)   // same file, larger
  })

  it('re-binding to the same story is a no-op, not an error', () => {
    expect(() => bind(held, COMMONS_2000, { item: 'story-a' })).not.toThrow()
  })

  it('throws rather than quietly reassigning', () => {
    expect(() => bind(held, COMMONS_1280, { item: 'story-b' })).toThrow(/already bound/)
  })

  it('does not mutate the ledger it was handed', () => {
    expect(Object.keys(EMPTY.bindings)).toHaveLength(0)
  })

  it('finds the picture a story is holding, newest first', () => {
    const two = bind(held, 'https://example.com/later.jpg', { item: 'story-a', at: '2026-08-22' })
    expect(imageFor(two, 'story-a')).toBe('https://example.com/later.jpg')
    expect(imageFor(two, 'nobody')).toBe(null)
  })
})

describe('the lead changes every day', () => {
  const ledger = recordLead(
    recordLead(EMPTY, { date: '2026-08-21', item: 'old', title: 'Old' }),
    { date: '2026-08-22', item: 'yesterday', title: 'Yesterday' },
  )
  const cands = [{ id: 'yesterday' }, { id: 'old' }, { id: 'fresh' }]

  it('reads back the lead recorded for a day', () => {
    expect(leadOn(ledger, '2026-08-22').item).toBe('yesterday')
    expect(leadOn(ledger, '2026-08-23')).toBe(null)
    expect(lastLead(ledger).item).toBe('yesterday')
  })

  it('keeps one entry per day when the job is re-run', () => {
    const again = recordLead(ledger, { date: '2026-08-22', item: 'other' })
    expect(again.leads.filter(l => l.date === '2026-08-22')).toHaveLength(1)
    expect(leadOn(again, '2026-08-22').item).toBe('other')
  })

  // The rule, stated the way a reader would: the story at the top today is not
  // the story that was at the top yesterday. This holds with no daily job run
  // at all, which is the point — it is a property of the page, not of the cron.
  it('will not lead with yesterday’s story', () => {
    expect(chooseLead(ledger, cands, '2026-08-23').id).toBe('fresh')
  })

  it('will not lead with any story from inside the memory window', () => {
    const banned = recentLeadIds(ledger, '2026-08-23')
    expect([...banned].sort()).toEqual(['old', 'yesterday'])
    expect(chooseLead(ledger, [{ id: 'old' }, { id: 'yesterday' }, { id: 'fresh' }], '2026-08-23').id).toBe('fresh')
  })

  it('forgets a lead once it falls out of the window', () => {
    const stale = recordLead(EMPTY, { date: '2026-08-01', item: 'ancient' })
    const asked = new Date(new Date('2026-08-01T00:00:00Z').getTime() + (LEAD_MEMORY_DAYS + 1) * 86400000)
      .toISOString().slice(0, 10)
    expect(recentLeadIds(stale, asked).has('ancient')).toBe(false)
  })

  // Once the day's lead is decided it is pinned, so the top of the page does
  // not swap under a reader when the feed re-ranks mid-session.
  it('pins the day’s lead once the run has decided it', () => {
    const decided = recordLead(ledger, { date: '2026-08-23', item: 'old' })
    expect(chooseLead(decided, cands, '2026-08-23').id).toBe('old')
  })

  it('falls back to the pages own order when the pinned story is gone', () => {
    const decided = recordLead(ledger, { date: '2026-08-23', item: 'dropped-from-the-feed' })
    expect(chooseLead(decided, cands, '2026-08-23').id).toBe('fresh')
  })

  it('takes a repeat over an empty top slot when every candidate has led', () => {
    expect(chooseLead(ledger, [{ id: 'yesterday' }], '2026-08-23').id).toBe('yesterday')
    expect(chooseLead(ledger, [], '2026-08-23')).toBe(null)
  })
})
