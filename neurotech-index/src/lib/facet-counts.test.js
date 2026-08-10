import { describe, it, expect } from 'vitest'
import { countFacets, entityMatchesFacets } from './facets'

const row = (fn = [], ax = [], ap = []) => ({
  facet_function: fn, facet_access: ax, facet_application: ap,
})

describe('countFacets', () => {
  it('counts rows per value of every dimension', () => {
    const items = [
      row(['records'], ['non_invasive'], ['epilepsy']),
      row(['records', 'decodes'], ['implanted_penetrating'], ['movement_restoration']),
      row(['stimulates'], ['non_invasive'], ['pain', 'epilepsy']),
    ]
    const c = countFacets(items)
    expect(c.function.records).toBe(2)
    expect(c.function.decodes).toBe(1)
    expect(c.function.stimulates).toBe(1)
    expect(c.access.non_invasive).toBe(2)
    expect(c.application.epilepsy).toBe(2)
    expect(c.application.pain).toBe(1)
  })

  it('states a zero rather than omitting the value', () => {
    // A missing key would read as "not counted" and the bar would keep offering
    // the value; an explicit zero is what lets it hide one that returns nothing.
    const c = countFacets([row(['records'])])
    expect(c.function.images).toBe(0)
    expect(c.application.psychiatric).toBe(0)
    expect(Object.keys(c.access).length).toBeGreaterThan(0)
  })

  it('never offers the exclusive sentinels', () => {
    const c = countFacets([row(['none'], ['not_applicable'])])
    expect(c.function).not.toHaveProperty('none')
    expect(c.access).not.toHaveProperty('not_applicable')
  })

  it('holds the other dimensions fixed and leaves its own free', () => {
    const items = [
      row(['records'], ['non_invasive'], []),
      row(['stimulates'], ['non_invasive'], []),
      row(['records'], ['implanted_penetrating'], []),
    ]
    const c = countFacets(items, { access: ['non_invasive'] })
    // Function is counted within the access selection...
    expect(c.function.records).toBe(1)
    expect(c.function.stimulates).toBe(1)
    // ...but access itself is counted freely, or a reader could never see what
    // switching to another access value would give them.
    expect(c.access.non_invasive).toBe(2)
    expect(c.access.implanted_penetrating).toBe(1)
  })

  it('ORs within a dimension the way the filter does', () => {
    const items = [
      row(['records'], [], ['epilepsy']),
      row(['stimulates'], [], ['pain']),
      row(['images'], [], ['epilepsy']),
    ]
    const c = countFacets(items, { function: ['records', 'stimulates'] })
    expect(c.application.epilepsy).toBe(1)   // only the 'records' row qualifies
    expect(c.application.pain).toBe(1)
  })

  it('agrees with the filter it describes', () => {
    // The count for a value must equal what selecting that value returns —
    // otherwise the number is a promise the results do not keep.
    const items = [
      row(['records'], ['non_invasive'], ['epilepsy']),
      row(['records', 'stimulates'], ['non_invasive'], ['pain']),
      row(['decodes'], ['implanted_penetrating'], ['communication_speech']),
      row([], [], []),
    ]
    const base = { access: ['non_invasive'] }
    const c = countFacets(items, base)
    for (const value of ['records', 'stimulates', 'decodes', 'images']) {
      const next = { ...base, function: [value] }
      const actual = items.filter(i => entityMatchesFacets(i, next)).length
      expect(c.function[value]).toBe(actual)
    }
  })

  it('returns all-zero counts for an empty list', () => {
    const c = countFacets([])
    expect(c.function.records).toBe(0)
    expect(c.total).toBe(0)
    expect(Object.values(c.application).every(n => n === 0)).toBe(true)
  })

  describe('total', () => {
    const items = [
      row(['records'], ['non_invasive'], ['epilepsy']),
      row(['records', 'stimulates'], ['non_invasive'], ['pain']),
      row(['decodes'], ['implanted_penetrating'], ['communication_speech']),
      row([], [], []),
    ]

    it('is every item when nothing is selected', () => {
      // Including the item carrying no facet at all — the pages print this as
      // "N results", and an unclassified row is still a result.
      expect(countFacets(items).total).toBe(4)
    })

    it('applies every dimension, unlike the per-value counts', () => {
      expect(countFacets(items, { function: ['records'] }).total).toBe(2)
      expect(countFacets(items, { function: ['records'], application: ['pain'] }).total).toBe(1)
      expect(countFacets(items, { function: ['images'] }).total).toBe(0)
    })

    it('equals what the filter returns, for any selection', () => {
      // This is the promise the number makes: the page's result count and the
      // total have to be the same number for the same filters.
      const selections = [
        {},
        { function: ['records'] },
        { access: ['non_invasive'] },
        { function: ['records', 'decodes'] },
        { function: ['records'], access: ['non_invasive'], application: ['pain'] },
        { application: ['epilepsy'] },
      ]
      for (const sel of selections) {
        const actual = items.filter(i => entityMatchesFacets(i, sel)).length
        expect(countFacets(items, sel).total).toBe(actual)
      }
    })
  })
})
