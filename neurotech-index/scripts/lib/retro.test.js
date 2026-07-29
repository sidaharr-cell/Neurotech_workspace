import { describe, it, expect } from 'vitest'
import {
  stripIdentity, inWindow, buildReferenceList, buildNegativeSet,
  freeze, verifyFrozen, recallAtDecile, negativeAtDecile, WINDOW,
} from './retro.js'

describe('entity stripping, spec 12 step 3', () => {
  it('replaces organisation names with a role placeholder', () => {
    const { item } = stripIdentity({ title: 'A Neuralink implant study', abstract: 'Medtronic funded this work.' })
    expect(item.title).toBe('A [ORGANISATION] implant study')
    expect(item.abstract).toBe('[ORGANISATION] funded this work.')
  })

  it('is case-insensitive and reports what it removed', () => {
    const { removed } = stripIdentity({ title: 'BLACKROCK and synchron', abstract: '' })
    expect(removed.sort()).toEqual(['blackrock', 'synchron'])
  })

  it('drops pure-identity fields outright', () => {
    const { item } = stripIdentity({ title: 't', authors: ['A. Person'], journal: 'Nature', sponsor: 'X Corp' })
    expect(item.authors).toBeUndefined()
    expect(item.journal).toBeUndefined()
    expect(item.sponsor).toBeUndefined()
  })

  it('does not mangle ordinary words that contain a name', () => {
    // "kernel" is on the list; "kernels" in a signal-processing sense is not.
    const { item } = stripIdentity({ title: 'Convolution kernels for decoding', abstract: '' })
    expect(item.title).toBe('Convolution kernels for decoding')
  })

  it('survives missing fields', () => {
    expect(() => stripIdentity({})).not.toThrow()
  })
})

describe('the window', () => {
  it.each([[2015, false], [2016, true], [2019, true], [2020, false]])('%i in window: %s', (y, want) => {
    expect(inWindow(y)).toBe(want)
  })
  it('is the 2016-2019 window the spec names', () => {
    expect(WINDOW).toEqual({ start: 2016, end: 2019 })
  })
})

describe('the reference list is built from outcomes, never from an opinion', () => {
  const items = [{ id: 'a', item_type: 'papers', year: 2017 }, { id: 'b', item_type: 'papers', year: 2018 },
    { id: 'c', item_type: 'news_feed', year: 2016 }, { id: 'd', item_type: 'papers', year: 2019 }]
  const signals = {
    recordHolders: new Set(['a']),
    approvedAfterWindow: new Set(['b']),
    pivotalReadouts: new Set(["c"]),
  }

  it('includes an item for each external signal, and names which', () => {
    const list = buildReferenceList(items, signals)
    expect(list.map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(list.find(e => e.id === 'a').reasons[0]).toMatch(/frontier record/)
    expect(list.find(e => e.id === 'b').reasons[0]).toMatch(/cleared or approved/)
  })

  it('excludes an item with no external signal', () => {
    expect(buildReferenceList(items, signals).some(e => e.id === 'd')).toBe(false)
  })

  it('records multiple reasons when several signals agree', () => {
    const list = buildReferenceList(items, { ...signals, approvedAfterWindow: new Set(['a', 'b']) })
    expect(list.find(e => e.id === 'a').reasons).toHaveLength(2)
  })
})

describe('the negative set targets hype directly', () => {
  const items = [{ id: 'a', year: 2017 }, { id: 'b', year: 2017 }, { id: 'c', year: 2018 }]
  const signals = { recordHolders: new Set(['a']), approvedAfterWindow: new Set(), resultsPosted: new Set() }

  it('keeps a covered item that produced no outcome', () => {
    const neg = buildNegativeSet(items, signals, new Set(['a', 'b']))
    expect(neg.map(e => e.id)).toEqual(['b'])
  })

  it('excludes an item that did pan out, however covered', () => {
    expect(buildNegativeSet(items, signals, new Set(['a'])).length).toBe(0)
  })

  it('excludes an item nobody covered', () => {
    expect(buildNegativeSet(items, signals, new Set()).length).toBe(0)
  })
})

describe('freezing prevents the list being edited after the scores are seen', () => {
  const list = [{ id: 'b' }, { id: 'a' }]

  it('is order independent', () => {
    expect(freeze(list).hash).toBe(freeze([{ id: 'a' }, { id: 'b' }]).hash)
  })

  it('changes when an entry is added', () => {
    expect(freeze([...list, { id: 'c' }]).hash).not.toBe(freeze(list).hash)
  })

  it('changes when an entry is removed', () => {
    expect(freeze([{ id: 'a' }]).hash).not.toBe(freeze(list).hash)
  })

  it('verifies an unchanged list', () => {
    const f = freeze(list)
    expect(verifyFrozen(list, f)).toBe(true)
    expect(verifyFrozen([...list, { id: 'z' }], f)).toBe(false)
  })
})

describe('recall is the primary metric, not precision', () => {
  const ranked = Array.from({ length: 100 }, (_, i) => `i${i}`)

  it('scores a decile containing every reference item as perfect recall', () => {
    const r = recallAtDecile(ranked, ['i0', 'i5', 'i9'])
    expect(r.decileSize).toBe(10)
    expect(r.recall).toBe(1)
    expect(r.missed).toEqual([])
  })

  it('counts a decile full of extras as success, since precision is not the metric', () => {
    // Spec 12: five that mattered plus fifteen that did not is a SUCCESS.
    expect(recallAtDecile(ranked, ['i0', 'i1']).recall).toBe(1)
  })

  it('reports what was missed', () => {
    const r = recallAtDecile(ranked, ['i0', 'i50'])
    expect(r.recall).toBe(0.5)
    expect(r.missed).toEqual(['i50'])
  })

  it('handles an empty reference list without dividing by zero', () => {
    expect(recallAtDecile(ranked, []).recall).toBeNull()
  })

  it('always keeps at least one item in the decile', () => {
    expect(recallAtDecile(['a', 'b'], ['a']).decileSize).toBe(1)
  })
})

describe('the negative case', () => {
  const ranked = Array.from({ length: 100 }, (_, i) => `i${i}`)

  it('reports zero when no hyped item reached the top decile', () => {
    const n = negativeAtDecile(ranked, ['i50', 'i80'])
    expect(n.inTopDecile).toBe(0)
    expect(n.rate).toBe(0)
  })

  it('names the offenders when hyped items do rank', () => {
    const n = negativeAtDecile(ranked, ['i1', 'i2', 'i90'])
    expect(n.inTopDecile).toBe(2)
    expect(n.offenders).toEqual(['i1', 'i2'])
    expect(n.rate).toBeCloseTo(2 / 3, 6)
  })
})
