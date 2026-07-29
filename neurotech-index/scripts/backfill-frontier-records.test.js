import { describe, it, expect } from 'vitest'
import { validateEntry, diffFields, recordId } from './backfill-frontier-records.js'

/** A record that passes every check, for tests to break one field at a time. */
const valid = (over = {}) => ({
  subfield: 'INVASIVE_BCI_INTRACORTICAL',
  axis: 'decoded words per minute, chronic, ALS',
  axis_type: 'performance',
  current_value: '62 words per minute',
  established_date: '2023-08-23',
  confidence: 'single-group',
  source_url: 'https://www.nature.com/articles/s41586-023-06377-x',
  ...over,
})

const errorsFor = (entry, key = 'wpm-als', keys = ['wpm-als']) =>
  validateEntry(key, entry, keys)

describe('a well-formed record passes', () => {
  it('reports no problems', () => {
    expect(errorsFor(valid())).toEqual([])
  })

  it('accepts an evidence record with an indication', () => {
    expect(errorsFor(valid({
      subfield: 'DBS', axis_type: 'evidence', indication: 'treatment_resistant_depression',
      axis: 'strongest evidence, DBS for treatment-resistant depression',
      current_value: 'randomized sham-controlled trial, n = 90',
    }))).toEqual([])
  })

  it('accepts a manual-only subfield, which is the point of keeping them', () => {
    expect(errorsFor(valid({ subfield: 'INTERFACE_MATERIALS' }))).toEqual([])
    expect(errorsFor(valid({ subfield: 'FOCUSED_ULTRASOUND' }))).toEqual([])
  })
})

describe('vocabulary validation', () => {
  it('rejects a subfield outside the partition', () => {
    expect(errorsFor(valid({ subfield: 'INVASIVE_BCI' })).join()).toMatch(/not in SUBFIELD_IDS/)
  })

  it('rejects an axis type outside the enum', () => {
    expect(errorsFor(valid({ axis_type: 'importance' })).join()).toMatch(/axis_type/)
  })

  it('rejects a confidence outside the enum', () => {
    expect(errorsFor(valid({ confidence: 'high' })).join()).toMatch(/confidence/)
  })

  it('rejects an indication outside the vocabulary', () => {
    expect(errorsFor(valid({
      axis_type: 'evidence', indication: 'brain_fog',
    })).join()).toMatch(/not in INDICATION_IDS/)
  })
})

describe('the evidence/indication coherence rule', () => {
  it('requires an indication on an evidence record', () => {
    expect(errorsFor(valid({ axis_type: 'evidence' })).join())
      .toMatch(/evidence.*requires an indication/)
  })

  it('forbids an indication on any other axis type', () => {
    // An indication on a performance axis means retrieval would file a
    // capability record where a trial goes looking for evidence.
    expect(errorsFor(valid({ indication: 'epilepsy' })).join())
      .toMatch(/only valid on an evidence record/)
  })
})

describe('traceability', () => {
  it('rejects a record with no source link', () => {
    expect(errorsFor(valid({ source_url: undefined })).join()).toMatch(/source_url/)
    expect(errorsFor(valid({ source_url: 'nature.com/foo' })).join()).toMatch(/source_url/)
  })

  it('rejects a value with no units', () => {
    // Spec 3.1 requires units in the string. A bare "62" means nothing six
    // months later without its axis.
    expect(errorsFor(valid({ current_value: '62' })).join()).toMatch(/carries no units/)
  })

  it('accepts units expressed as a cohort size', () => {
    expect(errorsFor(valid({ current_value: 'n = 200, 2024' }))).toEqual([])
  })

  it('rejects a malformed established_date', () => {
    expect(errorsFor(valid({ established_date: '2023' })).join()).toMatch(/YYYY-MM-DD/)
  })
})

describe('supersede references', () => {
  it('rejects a record superseding itself', () => {
    expect(errorsFor(valid({ supersedes: 'wpm-als' })).join()).toMatch(/cannot supersede itself/)
  })

  it('rejects a supersedes pointing at no entry in the file', () => {
    expect(errorsFor(valid({ supersedes: 'nope' })).join()).toMatch(/names no entry/)
  })

  it('accepts a supersedes naming another entry', () => {
    expect(validateEntry('wpm-als-2023', valid({ supersedes: 'wpm-als-2021' }),
      ['wpm-als-2023', 'wpm-als-2021'])).toEqual([])
  })
})

describe('keys and ids', () => {
  it('rejects a key that is not a slug', () => {
    expect(errorsFor(valid(), 'WPM ALS', ['WPM ALS']).join()).toMatch(/lowercase slug/)
  })

  it('derives a stable id from the key', () => {
    expect(recordId('wpm-als')).toBe(recordId('wpm-als'))
    expect(recordId('wpm-als')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('gives different keys different ids, so renaming makes a second record', () => {
    expect(recordId('wpm-als')).not.toBe(recordId('wpm-als-2023'))
  })
})

describe('revision detection', () => {
  const stored = {
    subfield: 'DBS', axis: 'a', axis_type: 'performance', indication: null,
    current_value: '10 mm', held_by_type: null, held_by_id: null,
    established_date: '2020-01-01', confidence: 'single-group', notes: null,
    source_url: 'https://example.org/a', record_version: 1,
  }

  it('finds nothing when the entry is unchanged', () => {
    expect(diffFields(stored, { ...stored })).toEqual([])
  })

  it('ignores untracked columns, so a re-run is idempotent', () => {
    // Provenance and version are written BY a revision. Tracking them would make
    // every run look changed and bump the version forever.
    expect(diffFields(stored, { ...stored, record_version: 9, pipeline_version: 'x' })).toEqual([])
  })

  it('names each changed field', () => {
    expect(diffFields(stored, { ...stored, current_value: '12 mm', confidence: 'replicated' }))
      .toEqual(['current_value', 'confidence'])
  })

  it('treats undefined and null as the same absence', () => {
    expect(diffFields(stored, { ...stored, notes: undefined })).toEqual([])
  })
})
