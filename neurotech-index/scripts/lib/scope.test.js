import { describe, it, expect } from 'vitest'
import { scopeFlags, scopeVerdict } from './scope.js'

const org = (name, description = '') => ({ name, description })
const verdict = o => scopeVerdict(o).verdict

describe('a real neurotech company passes cleanly', () => {
  it('clears a device maker', () => {
    expect(scopeFlags(org('Neuralink', 'Develops implantable brain-computer interface devices.'))).toEqual([])
    expect(verdict(org('Cortivision', 'Portable fNIRS imaging systems for measuring brain activity.'))).toBe('in_scope')
  })

  it('clears diagnostic software', () => {
    expect(verdict(org('Viz.AI', 'Software that identifies anomalies in brain scans for stroke triage.'))).toBe('in_scope')
  })
})

describe('the three ways a live row failed the inclusion rule', () => {
  /** Sorts as the third-oldest "company" in the index. */
  it('flags a professional society', () => {
    const v = scopeVerdict(org('Society for Neuroscience', 'A professional society for brain researchers.'))
    expect(v.verdict).toBe('review')
    expect(v.flags.join(' ')).toMatch(/society/)
  })

  /** Six employees, Trustpilot patient reviews. Treats patients, makes nothing. */
  it('flags a treatment clinic', () => {
    const v = scopeVerdict(org('APEX NEURO', 'A neurorehabilitation clinic specialising in MS, MND and FND.'))
    expect(v.verdict).toBe('review')
  })

  /** The neurotech BrainCom is an EU project at a different domain. */
  it('flags an agency that only looks neurotech by its name', () => {
    const v = scopeVerdict(org('BrainCom', 'A strategic communications agency serving healthcare clients.'))
    expect(v.verdict).toBe('review')
  })

  it('flags a distributor rather than a maker', () => {
    expect(verdict(org('NeuroDist', 'Distributor of EEG electrodes across the Nordics.'))).toBe('review')
  })
})

describe('off topic entirely', () => {
  it('flags a row whose name and description never mention the nervous system', () => {
    const v = scopeVerdict(org('Acme Logistics', 'Freight forwarding and warehousing.'))
    expect(v.verdict).toBe('review')
    expect(v.flags.join(' ')).toMatch(/nervous system/)
  })
})

describe('the generous half of the test', () => {
  /**
   * On topic with no product noun is a nudge, not a verdict: plenty of real
   * companies describe themselves without saying "device" or "platform".
   */
  it('only nudges when a company is on topic but vague', () => {
    expect(verdict(org('Neuro Ventures', 'We work on brain health.'))).toBe('check')
  })

  it('says so rather than guessing when there is nothing to read', () => {
    expect(scopeFlags(org('Mystery Co', ''))).toEqual(['no description to judge from'])
    expect(scopeFlags({})).toEqual(['no description to judge from'])
  })

  /** A hospital PARTNER is not a hospital; the words appear in normal prose, so
   *  the test must not fire on a company that merely mentions one. */
  it('does not flag a company for naming its customers', () => {
    expect(verdict(org('Ceribell', 'Rapid EEG device deployed in hospital emergency departments.')))
      .toBe('in_scope')
  })
})

describe('real rows the first version of these rules got wrong', () => {
  /** An intracortical microelectrode array is as neurotech as it gets. A
   *  leading word boundary on the stems made it read as off topic. */
  it('matches neuro stems inside longer words', () => {
    expect(scopeFlags(org('Paradromics',
      'Connexus high-data-rate intracortical microelectrode array aimed at restoring communication.')))
      .toEqual([])
  })

  /** "clinical-stage company" and "sleep clinicians" are not clinics. */
  it('does not read "clinical" or "clinicians" as a clinic', () => {
    const cognito = scopeVerdict(org('Cognito Therapeutics',
      'A clinical-stage company developing digital therapeutics with a neuromodulation platform.'))
    expect(cognito.flags.join(' ')).not.toMatch(/hospital or clinic/)
    const enso = scopeVerdict(org('Ensodata',
      'Empowering clinicians with waveform AI. Sleep clinicians spend more time helping patients.'))
    expect(enso.flags.join(' ')).not.toMatch(/hospital or clinic/)
  })

  /**
   * Setpoint makes a vagus nerve stimulator and describes itself as
   * "bioelectronic medicine". A terse description is a reason to improve the
   * description, not to question the company, so it must not reach `review`.
   */
  it('only nudges when the description is terse rather than off topic', () => {
    const v = scopeVerdict(org('Setpoint Medical',
      'Setpoint Medical uses bioelectronic medicine to provide treatment for chronic autoimmune diseases'))
    expect(v.verdict).not.toBe('review')
  })

  it('still reaches review for what a row actually IS', () => {
    expect(verdict(org('Society for Neuroscience', 'A professional society for brain researchers.'))).toBe('review')
    expect(verdict(org('APEX NEURO', 'A neurorehabilitation clinic specialising in MS and MND.'))).toBe('review')
  })
})
