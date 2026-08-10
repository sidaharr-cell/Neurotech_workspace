import { describe, it, expect } from 'vitest'
import { facetSearch } from './useUrlFacets'

describe('facetSearch', () => {
  it('carries every selected facet value', () => {
    expect(facetSearch('?fn=records&ax=implanted_penetrating&app=epilepsy'))
      .toBe('?fn=records&ax=implanted_penetrating&app=epilepsy')
  })

  it('carries repeated values within a dimension', () => {
    // OR within a facet is expressed as a repeated key; dropping to the last one
    // would quietly narrow the reader's selection on the way to the next page.
    expect(facetSearch('?fn=records&fn=decodes')).toBe('?fn=records&fn=decodes')
  })

  it('is empty when nothing is selected', () => {
    // Empty, not '?', so a link reads /trials rather than /trials?
    expect(facetSearch('')).toBe('')
    expect(facetSearch('?q=cochlear')).toBe('')
  })

  it('drops the search term', () => {
    // A term typed to find one paper is not a standing filter, and `q` means
    // something different on every page that has one.
    expect(facetSearch('?q=cochlear&fn=records')).toBe('?fn=records')
  })

  it('drops the single-select extras', () => {
    // These are the dangerous ones: every page names its own, and the ones that
    // look shared are not. Recency is week|month|year on the feed and y1|y3|y10
    // on research, so carrying it would set a filter the destination cannot read.
    expect(facetSearch('?recency=week&phase=3&fda=510k&source=arxiv&ax=non_invasive'))
      .toBe('?ax=non_invasive')
  })

  it('ignores params it does not know', () => {
    expect(facetSearch('?utm_source=x&page=4&app=pain')).toBe('?app=pain')
  })

  it('round-trips what useUrlFacets reads back', () => {
    // The contract that makes the carry work: what this hands to the next page
    // is exactly what that page's hook parses out of its own URL.
    const carried = facetSearch('?q=x&fn=records&fn=images&ax=non_invasive&recency=week')
    const p = new URLSearchParams(carried)
    expect(p.getAll('fn')).toEqual(['records', 'images'])
    expect(p.getAll('ax')).toEqual(['non_invasive'])
    expect(p.getAll('app')).toEqual([])
  })
})
