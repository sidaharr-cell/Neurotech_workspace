import { describe, it, expect } from 'vitest'
import {
  SUBFIELD_IDS, MANUAL_ONLY_SUBFIELDS, subfieldFor, isSubfield, PARTITION_VERSION,
} from './subfields.js'

const row = (fn = [], ax = [], app = []) => ({
  facet_function: fn, facet_access: ax, facet_application: app,
})

describe('the partition itself', () => {
  it('has unique ids and a version stamp', () => {
    expect(new Set(SUBFIELD_IDS).size).toBe(SUBFIELD_IDS.length)
    expect(PARTITION_VERSION).toMatch(/^sf-/)
  })

  it('keeps the two subfields facets cannot express, but never derives them', () => {
    // Dropping them would discard two real frontier axes (ultrasound spatial
    // resolution, chronic encapsulation) that Phase 2 needs somewhere to put.
    expect(MANUAL_ONLY_SUBFIELDS).toEqual(['FOCUSED_ULTRASOUND', 'INTERFACE_MATERIALS'])
    for (const id of MANUAL_ONLY_SUBFIELDS) expect(isSubfield(id)).toBe(true)
  })

  it('never derives a manual-only subfield from any facet combination', () => {
    const fns = ['records', 'stimulates', 'images', 'decodes']
    const axs = ['non_invasive', 'minimally_invasive', 'implanted_non_penetrating', 'implanted_penetrating']
    const apps = ['movement_disorders', 'psychiatric', 'epilepsy', 'sensory_restoration',
      'movement_restoration', 'autonomic_organ', 'pain', 'research_tool']
    for (const fn of fns) for (const ax of axs) for (const app of apps) {
      // Also exercise the paired-function combinations the badges depend on.
      for (const f of [[fn], [fn, 'decodes'], [fn, 'records'], [fn, 'stimulates']]) {
        expect(MANUAL_ONLY_SUBFIELDS).not.toContain(subfieldFor(row(f, [ax], [app])))
      }
    }
  })
})

describe('BCI splits by access', () => {
  const bci = ['records', 'decodes']
  it.each([
    ['implanted_penetrating', 'INVASIVE_BCI_INTRACORTICAL'],
    ['implanted_non_penetrating', 'INVASIVE_BCI_ECOG'],
    ['minimally_invasive', 'BCI_MINIMALLY_INVASIVE'],
    ['non_invasive', 'BCI_NONINVASIVE'],
  ])('%s → %s', (access, expected) => {
    expect(subfieldFor(row(bci, [access]))).toBe(expected)
  })

  it('needs both records and decodes, matching the BCI badge', () => {
    // records alone is acquisition hardware, not a BCI.
    expect(subfieldFor(row(['records'], ['implanted_penetrating'])))
      .toBe('IMAGING_AND_RECORDING_HARDWARE')
  })
})

describe('stimulation ordering', () => {
  it('puts a responsive neurostimulator in closed-loop epilepsy, not DBS', () => {
    // It is implanted and stimulating, so the DBS rule would also match. The
    // epilepsy indication is the distinguishing fact and has to be checked first.
    const rns = row(['records', 'stimulates'], ['implanted_penetrating'], ['epilepsy'])
    expect(subfieldFor(rns)).toBe('CLOSED_LOOP_EPILEPSY')
  })

  it('routes implanted movement-disorder stimulation to DBS', () => {
    expect(subfieldFor(row(['stimulates'], ['implanted_penetrating'], ['movement_disorders'])))
      .toBe('DBS')
  })

  it('routes sensory restoration to sensory prosthetics', () => {
    expect(subfieldFor(row(['stimulates'], ['implanted_non_penetrating'], ['sensory_restoration'])))
      .toBe('SENSORY_PROSTHETICS')
  })

  it('routes organ-directed stimulation to peripheral and cranial nerve', () => {
    expect(subfieldFor(row(['stimulates'], ['minimally_invasive'], ['autonomic_organ'])))
      .toBe('PERIPHERAL_CRANIAL_NERVE_STIM')
  })

  it('returns null for stimulation for pain rather than guessing', () => {
    // Facets cannot say whether this is spinal cord, peripheral, or cranial
    // nerve. Null is measurable; a wrong subfield is not. See the file header.
    expect(subfieldFor(row(['stimulates'], ['implanted_penetrating'], ['pain']))).toBeNull()
  })
})

describe('algorithms and instrumentation', () => {
  it('treats decoding without recording as an algorithm', () => {
    expect(subfieldFor(row(['decodes'], ['not_applicable'], ['research_tool'])))
      .toBe('DECODING_ALGORITHMS')
  })

  it('treats imaging as acquisition hardware', () => {
    expect(subfieldFor(row(['images'], ['non_invasive'], ['diagnostics'])))
      .toBe('IMAGING_AND_RECORDING_HARDWARE')
  })
})

describe('null cases', () => {
  it.each([
    ['no row', null],
    ['unclassified row', row()],
    ['function none', row(['none'], ['not_applicable'], [])],
  ])('%s → null', (_label, input) => {
    expect(subfieldFor(input)).toBeNull()
  })

  it('only ever returns a member of the vocabulary', () => {
    const out = subfieldFor(row(['records', 'decodes'], ['implanted_penetrating'], ['communication_speech']))
    expect(SUBFIELD_IDS).toContain(out)
  })
})
