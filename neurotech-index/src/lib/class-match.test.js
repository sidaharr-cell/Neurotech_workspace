import { describe, it, expect } from 'vitest'
import { rankClasses } from './class-match'
import CLASS_POOL from '../data/class-images.json'

const story = (title, over = {}) => ({ id: title, title, ...over })

describe('rankClasses', () => {
  it('puts the technology the record names first', () => {
    expect(rankClasses(story('Deep brain stimulation for essential tremor'))[0]).toBe('dbs')
    expect(rankClasses(story('A cochlear implant in a child with hearing loss'))[0]).toBe('cochlear_implant')
    expect(rankClasses(story('Transcranial magnetic stimulation for depression'))[0]).toBe('tms')
    expect(rankClasses(story('Low-intensity focused ultrasound of the thalamus'))[0]).toBe('fus')
  })

  it('prefers the longer phrase when two rules both match', () => {
    // "stimulation" alone says almost nothing; "spinal cord stimulation" says
    // which picture belongs beside the headline.
    expect(rankClasses(story('Spinal cord stimulation reduces chronic pain'))[0]).toBe('scs')
  })

  it('reads the summary and the topics, not only the headline', () => {
    expect(rankClasses(story('New results', { summary: 'A powered exoskeleton for gait training' }))[0]).toBe('exoskeleton')
    expect(rankClasses(story('New results', { topics: ['electroencephalography'] }))[0]).toBe('eeg')
  })

  it('falls back to what the record was classified as', () => {
    const ranked = rankClasses(story('An untitled record', { facet_function: ['images'] }))
    expect(ranked[0]).toBe('mri')
  })

  it('returns every class in the pool, so a caller always reaches a picture', () => {
    const ranked = rankClasses(story('Nothing in particular'))
    expect(new Set(ranked).size).toBe(ranked.length)
    for (const id of Object.keys(CLASS_POOL)) expect(ranked).toContain(id)
  })

  it('answers for a record that says nothing at all', () => {
    expect(rankClasses(null).length).toBeGreaterThan(0)
    expect(rankClasses({}).length).toBeGreaterThan(0)
  })
})
