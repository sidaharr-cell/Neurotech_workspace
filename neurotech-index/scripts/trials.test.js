import { describe, it, expect } from 'vitest'
import { trialToRow } from './trials.js'

// A real briefSummary shape: registries write several sentences, and the ones
// that matter (design, blinding, endpoints) come last.
const LONG = 'Background: Functional movement disorder (FMD) is a common and disabling condition. '
  + 'This study tests whether intermittent theta burst stimulation of the dorsolateral prefrontal cortex '
  + 'improves symptom severity in adults with FMD. Objective: To determine the effect of active versus '
  + 'sham stimulation on the Simplified Functional Movement Disorders Rating Scale at twelve weeks. '
  + 'Eligibility: Adults between 18 and 80 who have been diagnosed with FMD by a neurologist. '
  + 'Design: Participants will be randomized one to one to active or sham stimulation, and both the '
  + 'participant and the rating clinician will be blinded to assignment for the duration of the trial.'

const trial = (over = {}) => ({ nctId: 'NCT00000001', title: 'A Trial', summary: '', url: 'https://x', ...over })

describe('trialToRow — summary', () => {
  it('stores the brief summary whole', () => {
    // It used to slice at 500 characters, which landed mid-sentence on 4,956 of
    // 8,366 trials and truncated "About this trial" on the detail page.
    expect(LONG.length).toBeGreaterThan(500)
    expect(trialToRow(trial({ summary: LONG })).summary).toBe(LONG)
  })

  it('keeps the last sentence, which is where the design is stated', () => {
    const { summary } = trialToRow(trial({ summary: LONG }))
    expect(summary.endsWith('for the duration of the trial.')).toBe(true)
    expect(summary.trim()).toMatch(/[.!?]$/)
  })

  it('handles a trial with no summary at all', () => {
    expect(trialToRow(trial({ summary: '' })).summary).toBe('')
    expect(trialToRow(trial({ summary: null })).summary).toBe('')
    expect(trialToRow(trial({ summary: undefined })).summary).toBe('')
  })

  it('leaves a short summary untouched', () => {
    const short = 'A single-arm feasibility study of an implanted vagus nerve stimulator.'
    expect(trialToRow(trial({ summary: short })).summary).toBe(short)
  })
})
