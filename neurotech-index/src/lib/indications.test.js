import { describe, it, expect } from 'vitest'
import {
  INDICATIONS, INDICATION_IDS, INDICATION_VERSION,
  normalizeCondition, indicationFor, indicationsFor, isNotAnIndication, isIndication,
} from './indications.js'

describe('the vocabulary itself', () => {
  it('has unique ids, labels, and a version stamp', () => {
    expect(new Set(INDICATION_IDS).size).toBe(INDICATION_IDS.length)
    expect(INDICATION_VERSION).toMatch(/^ind-/)
    for (const i of INDICATIONS) expect(i.label).toBeTruthy()
  })

  it('gives every entry at least one matching rule', () => {
    for (const i of INDICATIONS) {
      const n = (i.stems?.length || 0) + (i.words?.length || 0) + (i.phrases?.length || 0)
      expect(n, `${i.id} has no rules`).toBeGreaterThan(0)
    }
  })
})

describe('normalization', () => {
  it.each([
    ["Parkinson's Disease (PD)", 'parkinsons disease pd'],
    ['PARKINSON DISEASE (Disorder)', 'parkinson disease disorder'],
    ['Parkinson&#39;s Disease (PD)', 'parkinsons disease pd'],
    ['Depression - Major Depressive Disorder', 'depression major depressive disorder'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeCondition(raw)).toBe(expected)
  })

  it('survives empty and nullish input', () => {
    for (const v of [null, undefined, '', '   ']) expect(normalizeCondition(v)).toBe('')
  })
})

describe('spelling variants collapse to one id', () => {
  it('maps every observed Parkinson spelling to one indication', () => {
    // These are the real strings in the corpus, at 397/193/14/6/8/7 trials each.
    const variants = ["Parkinson Disease", "Parkinson's Disease", "Parkinson Disease (PD)",
      "Parkinsons Disease", "PD - Parkinson's Disease", "Parkinson&#39;s Disease (PD)",
      "Parkinson's Disease and Parkinsonism", "Parkinson Disease, Idiopathic"]
    for (const v of variants) expect(indicationFor(v), v).toBe('parkinsons_disease')
  })

  it('maps every observed spinal cord injury spelling to one indication', () => {
    const variants = ['Spinal Cord Injuries', 'Spinal Cord Injury', 'Spinal Cord Injuries (SCI)',
      'SCI - Spinal Cord Injury', 'Cervical Spinal Cord Injury', 'Chronic Spinal Cord Injury']
    for (const v of variants) expect(indicationFor(v), v).toBe('spinal_cord_injury')
  })

  it('maps every observed ALS spelling to one indication', () => {
    for (const v of ['Amyotrophic Lateral Sclerosis', 'ALS', 'ALS (Amyotrophic Lateral Sclerosis)',
      'Amyotrophic Lateral Sclerosis (ALS)', 'Motor Neuron Disease']) {
      expect(indicationFor(v), v).toBe('amyotrophic_lateral_sclerosis')
    }
  })
})

describe('acronyms are whole-word matched', () => {
  // Substring matching is the bug this guards: `als` is inside "cerebral palsy"
  // and `sci` is inside "consciousness". Both would silently mis-file a record.
  it('does not read ALS out of "Cerebral Palsy"', () => {
    expect(indicationFor('Cerebral Palsy')).toBe('cerebral_palsy')
  })

  it('does not read SCI out of "Disorder of Consciousness"', () => {
    expect(indicationFor('Disorder of Consciousness')).toBe('disorders_of_consciousness')
  })

  it('does not read ALS out of "Multiple Sclerosis"', () => {
    expect(indicationFor('Multiple Sclerosis')).toBe('multiple_sclerosis')
  })
})

describe('ordering: specific beats general', () => {
  // Getting this order wrong is the whole failure mode of the vocabulary.
  it.each([
    ['Treatment Resistant Depression', 'treatment_resistant_depression'],
    ['Depressive Disorder, Treatment-Resistant', 'treatment_resistant_depression'],
    ['Major Depressive Disorder', 'major_depressive_disorder'],
    ['Bipolar Depression', 'bipolar_disorder'],
    ['Chronic Low Back Pain', 'low_back_pain'],
    ['Chronic Neuropathic Pain', 'neuropathic_pain'],
    ['Painful Diabetic Neuropathy', 'neuropathic_pain'],
    ['Chronic Pain', 'chronic_pain'],
    ['Neurogenic Bladder', 'neurogenic_bladder'],
    ['Overactive Bladder (OAB)', 'overactive_bladder'],
  ])('%s → %s', (condition, expected) => {
    expect(indicationFor(condition)).toBe(expected)
  })
})

describe('non-indications', () => {
  it.each([
    'Deep Brain Stimulation', 'Transcranial Magnetic Stimulation', 'Spinal Cord Stimulation',
    'Vagus Nerve Stimulation', 'Healthy', 'Healthy Volunteers', 'Quality of Life',
    'Electroencephalography', 'Cochlear Implant', 'Neuromodulation',
  ])('%s is not an indication', (condition) => {
    expect(indicationFor(condition)).toBeNull()
    expect(isNotAnIndication(condition)).toBe(true)
  })

  it('checks the vocabulary before the reject list', () => {
    // Reject-first would discard both of these: "cochlear implant" and
    // "rehabilitation" are on the reject list, but each string names a real
    // indication that a trial actually studies.
    expect(indicationFor('Cochlear Hearing Loss')).toBe('hearing_loss')
    expect(indicationFor('Stroke Rehabilitation')).toBe('stroke')
  })

  it('does not let the reject list swallow PTSD', () => {
    // 'stress' appears in the reject list's neighbourhood; PTSD must survive it.
    expect(indicationFor('Post Traumatic Stress Disorder')).toBe('post_traumatic_stress_disorder')
    expect(indicationFor('Stress Disorders, Post-Traumatic')).toBe('post_traumatic_stress_disorder')
  })
})

describe('uncovered conditions return null rather than a guess', () => {
  it.each(['Breast Cancer', 'Cataract', 'Rheumatoid Arthritis', 'Movement Disorders'])(
    '%s → null', (condition) => {
      expect(indicationFor(condition)).toBeNull()
    })

  it('only ever returns a member of the vocabulary', () => {
    for (const c of ['Epilepsy', 'Stroke', 'Tinnitus', 'Obesity']) {
      expect(isIndication(indicationFor(c))).toBe(true)
    }
  })
})

describe('indicationsFor', () => {
  it('deduplicates across a trial condition list', () => {
    expect(indicationsFor(["Parkinson Disease", "Parkinson's Disease", 'Essential Tremor']))
      .toEqual(['parkinsons_disease', 'essential_tremor'])
  })

  it('drops non-indications and uncovered strings', () => {
    expect(indicationsFor(['Healthy Volunteers', 'Deep Brain Stimulation', 'Epilepsy']))
      .toEqual(['epilepsy'])
  })

  it('returns empty for empty input', () => {
    expect(indicationsFor([])).toEqual([])
    expect(indicationsFor()).toEqual([])
  })
})
