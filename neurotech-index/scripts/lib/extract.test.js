import { describe, it, expect } from 'vitest'
import {
  shapeExtraction, gapFlagged, trialDesignFrom, inputFor, GRANULARITIES, EXTRACTOR_VERSION,
} from './extract.js'

describe('shapeExtraction', () => {
  const full = {
    claimed: '  Restores   speech ', demonstrated: 'Decoded 62 words per minute in one participant',
    quantitative_results: [{ metric: 'rate', value: '62', units: 'wpm', conditions: 'one participant' }],
    methods_disclosed: true,
    artifacts_released: [{ type: 'code', terms: 'MIT', url: 'https://x' }],
    constraints_addressed: [{ constraint: 'custom fabrication', who_else_is_blocked: 'other labs' }],
    rhetorical_markers: ['unprecedented'],
  }

  it('normalizes whitespace and keeps the fields', () => {
    const e = shapeExtraction(full)
    expect(e.claimed).toBe('Restores speech')
    expect(e.quantitative_results).toHaveLength(1)
    expect(e.artifacts_released[0].terms).toBe('MIT')
  })

  it('treats an empty demonstrated as null, not as an empty string', () => {
    // "nothing disclosed" is a real answer the anti-hype control depends on.
    for (const v of [null, undefined, '', '   ']) {
      expect(shapeExtraction({ ...full, demonstrated: v }).demonstrated).toBeNull()
    }
  })

  it('drops quantitative results with no units', () => {
    const e = shapeExtraction({ ...full, quantitative_results: [{ metric: 'rate', value: '62' }] })
    expect(e.quantitative_results).toEqual([])
  })

  it('coerces a stringified array, as tool output sometimes arrives', () => {
    const e = shapeExtraction({ ...full, rhetorical_markers: '["first","novel"]' })
    expect(e.rhetorical_markers).toEqual(['first', 'novel'])
  })

  it('defaults a null beneficiary rather than inventing one', () => {
    const e = shapeExtraction({ ...full, constraints_addressed: [{ constraint: 'x y z', who_else_is_blocked: '' }] })
    expect(e.constraints_addressed[0].who_else_is_blocked).toBeNull()
  })

  it('survives a completely empty payload', () => {
    const e = shapeExtraction({})
    expect(e).toMatchObject({ claimed: null, demonstrated: null, methods_disclosed: false })
    expect(e.quantitative_results).toEqual([])
  })
})

describe('gapFlagged is a check on the model, so it runs as code', () => {
  const base = { claimed: 'Restores speech', demonstrated: 'Decoded 62 wpm', methods_disclosed: true, quantitative_results: [{ metric: 'a', value: '1', units: 'b' }] }

  it('does not flag a claim backed by disclosed evidence', () => {
    expect(gapFlagged(base)).toBe(false)
  })

  it('flags a claim with nothing demonstrated', () => {
    expect(gapFlagged({ ...base, demonstrated: null })).toBe(true)
  })

  it('flags a claim with no methods and no numbers', () => {
    // The company-announcement shape: an assertion and nothing to check it with.
    expect(gapFlagged({ ...base, methods_disclosed: false, quantitative_results: [] })).toBe(true)
  })

  it('does not flag when numbers are reported even without full methods', () => {
    expect(gapFlagged({ ...base, methods_disclosed: false })).toBe(false)
  })

  it('is false for a missing extraction rather than throwing', () => {
    expect(gapFlagged(null)).toBe(false)
  })

  it('exempts a trial from the evidence-behind-the-claim test', () => {
    // A registered trial has reported nothing BY DEFINITION, so "no methods, no
    // numbers" describes every well-designed trial that has not read out.
    // Applying it flagged 6 of 8 sampled trials.
    const unreported = { ...base, methods_disclosed: false, quantitative_results: [] }
    expect(gapFlagged(unreported, 'research')).toBe(true)
    expect(gapFlagged(unreported, 'trial')).toBe(false)
  })

  it('still flags a trial whose design establishes nothing', () => {
    // The exemption is narrow: an unregistered trial with no endpoint has no
    // design to establish anything, and that IS a gap.
    expect(gapFlagged({ ...base, demonstrated: null }, 'trial')).toBe(true)
  })
})

describe('trialDesignFrom copies the registry and infers only two fields', () => {
  const metadata = {
    nctId: 'NCT1', status: 'COMPLETED', sponsorClass: 'INDUSTRY',
    design: {
      registrationDate: '2019-04-01', allocation: 'RANDOMIZED', masking: 'DOUBLE',
      whoMasked: ['PARTICIPANT'], hasControlArm: true, hasShamArm: true, hasPlaceboArm: false,
      hasPrespecifiedPrimary: true, primaryOutcomes: [{ measure: 'Seizure frequency' }],
    },
  }

  it('copies every registry-stated field', () => {
    expect(trialDesignFrom(metadata)).toMatchObject({
      registered: true, registry_id: 'NCT1', randomized: true, comparator: 'sham',
      blinding: 'DOUBLE', primary_endpoint: 'Seizure frequency', prespecified: true,
      status: 'COMPLETED', sponsor_type: 'INDUSTRY',
    })
  })

  it('leaves the two inferential fields null when the model said nothing', () => {
    const d = trialDesignFrom(metadata)
    expect(d.powered).toBeNull()
    expect(d.null_interpretable).toBeNull()
  })

  it('takes those two from the inference when supplied', () => {
    const d = trialDesignFrom(metadata, { powered: true, null_interpretable: false })
    expect(d.powered).toBe(true)
    expect(d.null_interpretable).toBe(false)
  })

  it('names which fields came from the registry, so a reader can tell', () => {
    const d = trialDesignFrom(metadata)
    expect(d.registry_sourced).toContain('randomized')
    expect(d.registry_sourced).not.toContain('powered')
    expect(d.registry_sourced).not.toContain('null_interpretable')
  })

  it('reports no comparator for a single-arm trial', () => {
    const m = { ...metadata, design: { ...metadata.design, hasControlArm: false, hasShamArm: false } }
    expect(trialDesignFrom(m).comparator).toBeNull()
  })

  it('returns null when the trial has no ingested design block', () => {
    expect(trialDesignFrom({ nctId: 'NCT1' })).toBeNull()
  })
})

describe('inputFor records what was actually available', () => {
  it('calls a trial registry granularity and includes its endpoints', () => {
    const r = inputFor({
      title: 'A trial', summary: 'Summary text',
      metadata: { design: { primaryOutcomes: [{ measure: 'Seizure frequency', description: 'Monthly' }] } },
    }, 'trial')
    expect(r.granularity).toBe('registry')
    expect(r.content).toContain('Seizure frequency')
  })

  it('calls a real abstract abstract granularity', () => {
    expect(inputFor({ title: 'T', abstract: 'x'.repeat(400) }, 'research').granularity).toBe('abstract')
  })

  it('falls back to metadata when the body is too thin to be an abstract', () => {
    expect(inputFor({ title: 'T', abstract: 'short' }, 'research').granularity).toBe('metadata')
  })

  it('returns null when there is nothing to read', () => {
    expect(inputFor({}, 'research')).toBeNull()
  })

  it('only ever reports a known granularity', () => {
    for (const item of [{ title: 'T', abstract: 'x'.repeat(400) }, { title: 'T', abstract: 'a' }]) {
      expect(GRANULARITIES).toContain(inputFor(item, 'research').granularity)
    }
  })
})

describe('versioning', () => {
  it('stamps a version so a re-extraction is traceable', () => {
    expect(EXTRACTOR_VERSION).toMatch(/^extract-/)
  })
})
