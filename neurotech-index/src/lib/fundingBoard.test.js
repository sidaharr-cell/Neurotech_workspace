import { describe, it, expect } from 'vitest'
import {
  rankFunding, trailingTotals, trailingCutoff, toRow, stageEvidenceUrl, sortTitle,
  DEFAULT_STATUS_FILTER, STAGE_ORDER, unavailableLabel, ageBand, AGE_BANDS,
} from './fundingBoard'

const row = (over = {}) => ({
  id: over.id || over.name, name: 'X', total: 0, trailing: 0, latestAmount: 0,
  latestDate: null, status: null, modality: null, furthestStage: null, ...over,
})

describe('rankFunding', () => {
  it('reselects the set per sort key rather than reordering a fixed set', () => {
    // The defect this fixes: under the old chart, `small` could never appear
    // under "latest raise size" because it was not in the top 2 by total.
    const rows = [
      row({ name: 'big', total: 900, latestAmount: 10 }),
      row({ name: 'mid', total: 500, latestAmount: 20 }),
      row({ name: 'small', total: 100, latestAmount: 400 }),
    ]
    expect(rankFunding(rows, { sort: 'total_raised', limit: 2 }).map(r => r.name))
      .toEqual(['big', 'mid'])
    expect(rankFunding(rows, { sort: 'latest_raise_size', limit: 2 }).map(r => r.name))
      .toEqual(['small', 'mid'])
  })

  it('ranks from 1 within the returned set', () => {
    const rows = [row({ name: 'a', total: 5 }), row({ name: 'b', total: 9 })]
    expect(rankFunding(rows).map(r => r.rank)).toEqual([1, 2])
  })

  it('sorts companies with no qualifying round last under trailing_24mo, not as zero', () => {
    const rows = [
      row({ name: 'dormant', total: 900, trailing: 0 }),
      row({ name: 'active', total: 100, trailing: 50 }),
    ]
    const out = rankFunding(rows, { sort: 'trailing_24mo' })
    expect(out.map(r => r.name)).toEqual(['active', 'dormant'])
    expect(out[1].trailing).toBe(0)   // present, but the component draws no bar
  })

  it('hides acquired and defunct by default and keeps unresearched nulls', () => {
    const rows = [
      row({ name: 'live', total: 100, status: 'private' }),
      row({ name: 'unknown', total: 90, status: null }),
      row({ name: 'gone', total: 80, status: 'acquired' }),
      row({ name: 'dead', total: 70, status: 'defunct' }),
      row({ name: 'listed', total: 60, status: 'public' }),
    ]
    expect(rankFunding(rows, { statuses: DEFAULT_STATUS_FILTER }).map(r => r.name))
      .toEqual(['live', 'unknown', 'listed'])
  })

  it('filters by modality and by stage range', () => {
    const rows = [
      row({ name: 'bci', total: 100, modality: 'implanted_bci', furthestStage: 'pivotal' }),
      row({ name: 'neuro', total: 90, modality: 'neuromodulation', furthestStage: 'cleared_510k' }),
      row({ name: 'nostage', total: 80, modality: 'implanted_bci', furthestStage: null }),
    ]
    expect(rankFunding(rows, { modalities: ['implanted_bci'] }).map(r => r.name))
      .toEqual(['bci', 'nostage'])
    // A stage range excludes records with no stage: they cannot be placed in it.
    expect(rankFunding(rows, { stageMin: 'cleared_510k' }).map(r => r.name)).toEqual(['neuro'])
  })

  it('excludes companies with no total from the total_raised view', () => {
    const rows = [row({ name: 'a', total: 0 }), row({ name: 'b', total: 5 })]
    expect(rankFunding(rows).map(r => r.name)).toEqual(['b'])
  })
})

describe('trailingTotals', () => {
  const cutoff = '2024-01-01'
  it('sums only dated, amounted rounds inside the window', () => {
    const t = trailingTotals([
      { organization_id: 'a', amount_usd: 10, round_date: '2024-06-01' },
      { organization_id: 'a', amount_usd: 5, round_date: '2025-01-01' },
      { organization_id: 'a', amount_usd: 99, round_date: '2020-01-01' },  // outside
      { organization_id: 'b', amount_usd: null, round_date: '2024-06-01' }, // no amount
      { organization_id: 'c', amount_usd: 7, round_date: null },            // undated
    ], cutoff)
    expect(t).toEqual({ a: 15 })
  })

  it('produces a cutoff 24 months back', () => {
    const c = trailingCutoff(Date.parse('2026-07-28'))
    expect(c.slice(0, 4)).toBe('2024')
  })
})

describe('toRow', () => {
  it('marks a private-only total on a public company as partial', () => {
    const r = toRow({ id: '1', name: 'Axonics', status: 'public', capital_scope: 'private_only',
      total_raised_usd: 100 })
    expect(r.partialTotal).toBe(true)
  })

  it('does not mark a private company as partial', () => {
    expect(toRow({ id: '1', name: 'N', status: 'private', total_raised_usd: 1 }).partialTotal).toBe(false)
  })

  it('marks a defunct company only when it is known to have been listed', () => {
    // Pear Therapeutics listed through a SPAC, so its private-only total is
    // partial. A startup that folded without ever listing has a complete one,
    // and marking it partial would claim public capital that never existed.
    const listed = { id: '1', name: 'Pear', status: 'defunct', total_raised_usd: 1, was_publicly_traded: true }
    const never = { id: '2', name: 'Quiet', status: 'defunct', total_raised_usd: 1, was_publicly_traded: false }
    const unknown = { id: '3', name: 'Unresearched', status: 'defunct', total_raised_usd: 1 }
    expect(toRow(listed).partialTotal).toBe(true)
    expect(toRow(never).partialTotal).toBe(false)
    expect(toRow(unknown).partialTotal).toBe(false)   // null is not false, and not true either
  })

  it('always carries a reason when the latest raise is null', () => {
    const r = toRow({ id: '1', name: 'N', latest_raise_usd: null, latest_raise_unavailable_reason: null })
    expect(r.unavailableReason).toBe('unverified')   // never a bare n/a
  })

  it('clears the reason when an amount is present', () => {
    const r = toRow({ id: '1', name: 'N', latest_raise_usd: 500,
      latest_raise_unavailable_reason: 'no_filing_found' })
    expect(r.unavailableReason).toBeNull()
  })

  it('prefers display_name over the join key', () => {
    expect(toRow({ id: '1', name: 'Axonics Modulation Technologies, Inc.',
      display_name: 'Axonics' }).name).toBe('Axonics')
  })
})

describe('unavailableLabel', () => {
  it('never tells a reader a bankrupt company was acquired', () => {
    // The stored enum has no defunct value, so Pear Therapeutics is filed under
    // not_applicable_acquired. Its sourced status says otherwise.
    const pear = { status: 'defunct', unavailableReason: 'not_applicable_acquired' }
    expect(unavailableLabel(pear).short).toBe('Defunct')
  })

  it('still says Acquired for a company that was acquired', () => {
    expect(unavailableLabel({ status: 'acquired', unavailableReason: 'not_applicable_acquired' }).short)
      .toBe('Acquired')
  })

  it('falls back to the stored reason when the status is unknown', () => {
    expect(unavailableLabel({ status: null, unavailableReason: 'foreign_issuer_not_covered' }).short)
      .toBe('Non-US')
    expect(unavailableLabel({ status: null, unavailableReason: null }).short).toBe('Not checked')
  })
})

describe('stageEvidenceUrl', () => {
  it('links an NCT number to ClinicalTrials.gov', () => {
    expect(stageEvidenceUrl('clinicaltrials_gov', 'NCT05243147'))
      .toBe('https://clinicaltrials.gov/study/NCT05243147')
  })
  it('routes a PMA number to the PMA database and a K number to 510(k)', () => {
    expect(stageEvidenceUrl('openfda', 'P960009')).toContain('cfpma')
    expect(stageEvidenceUrl('openfda', 'K183303')).toContain('cfpmn')
  })
  it('returns null with no evidence id', () => {
    expect(stageEvidenceUrl('openfda', null)).toBeNull()
  })
})

describe('sortTitle', () => {
  it('names the active sort key', () => {
    expect(sortTitle('trailing_24mo', 20)).toContain('last 24 months')
    expect(sortTitle('total_raised', 20)).toContain('total capital raised')
    expect(sortTitle('total_raised', 12)).toContain('Top 12')
  })
})

describe('STAGE_ORDER', () => {
  it('matches the SQL enum order in migration 008', () => {
    expect(STAGE_ORDER[0]).toBe('preclinical')
    expect(STAGE_ORDER.at(-1)).toBe('withdrawn')
    expect(STAGE_ORDER).toHaveLength(10)
  })
})

// ── Company age, from an incorporation year or a bound on one ───────────────

describe('ageBand', () => {
  const NOW = 2026
  const exact = y => ({ incorporatedYear: y, incorporatedBefore: null })
  const bound = y => ({ incorporatedYear: null, incorporatedBefore: y })

  it('bands a company that declared a year', () => {
    expect(ageBand(exact(2023), NOW)).toBe('young')   // 3
    expect(ageBand(exact(2016), NOW)).toBe('mid')     // 10
    expect(ageBand(exact(2006), NOW)).toBe('old')     // 20
  })

  it('puts the band edges where the labels say they are', () => {
    expect(ageBand(exact(2020), NOW)).toBe('young')   // 6, under 7
    expect(ageBand(exact(2019), NOW)).toBe('mid')     // 7
    expect(ageBand(exact(2014), NOW)).toBe('mid')     // 12
    expect(ageBand(exact(2013), NOW)).toBe('old')     // 13, over 12
  })

  /**
   * The whole reason for banding. "Incorporated no later than 2004" means at
   * least 22 years old, which is one band and no other, so it places — a
   * continuous size could not have drawn it at all.
   */
  it('places a bound whose minimum age is already in the top band', () => {
    expect(ageBand(bound(2004), NOW)).toBe('old')     // at least 22
    expect(ageBand(bound(2009), NOW)).toBe('old')     // at least 17
  })

  it('refuses a bound that spans more than one band', () => {
    expect(ageBand(bound(2020), NOW)).toBe(null)      // at least 6: any band
    expect(ageBand(bound(2016), NOW)).toBe(null)      // at least 10: mid or old
    expect(ageBand(bound(2014), NOW)).toBe(null)      // at least 12: mid or old
  })

  it('has nothing to say without evidence', () => {
    expect(ageBand({ incorporatedYear: null, incorporatedBefore: null }, NOW)).toBe(null)
    expect(ageBand(null, NOW)).toBe(null)
  })

  it('only ever returns a band that exists', () => {
    const ids = new Set(AGE_BANDS.map(b => b.id))
    for (const y of [1995, 2005, 2015, 2025, 2026]) expect(ids.has(ageBand(exact(y), NOW))).toBe(true)
  })
})
