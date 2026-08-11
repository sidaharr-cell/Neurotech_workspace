/**
 * The neurotech lexicon gate, tested against headlines it actually got wrong.
 *
 * This gate is free and runs before any model call, which is what makes the wide
 * fetch affordable — and also what makes it dangerous: an item it rejects is
 * never scored, never stored, and never seen again. There is no downstream check
 * that would notice. Every case below is a real headline from the 11 Aug 2026
 * backfill that the first two versions of the gate silently discarded.
 */
import { describe, it, expect } from 'vitest'
import { onTopicByLexicon } from './lib/lexicon.js'

const t = (title, extra = {}) => ({ title, summary: '', ...extra })

describe('neurotech lexicon gate', () => {
  it('matches the bare compounds the press actually uses', () => {
    // The first version had "brain-computer" but not "brain implant" or "brain
    // chip", so the field's flagship coverage was rejected.
    for (const title of [
      'Brain implant restores the sensation of touch in a person with quadriplegia',
      'Brain-chip milestone: China completes world’s first commercial implant',
      'Thoughts became words: how a brain implant gave him back his life',
      'Chinese startup claims its brain implant takes just 10 minutes to place',
    ]) expect(onTopicByLexicon(t(title)), title).toBe(true)
  })

  it('matches compounds set with an en dash, not just a hyphen', () => {
    // Journals and Google News set "brain–computer interface" with U+2013, which
    // a [- ] character class does not match. This rejected the single most
    // on-topic phrase in the corpus.
    expect(onTopicByLexicon(t('Robust auditory attention decoding brain–computer interface'))).toBe(true)
    expect(onTopicByLexicon(t('A brain—machine interface for speech'))).toBe(true)
    expect(onTopicByLexicon(t('brain‑computer interface trial'))).toBe(true) // U+2011 non-breaking hyphen
  })

  it('matches patient-outcome headlines that name no device', () => {
    for (const title of [
      'Paralysed man regains hand function through novel brain technology',
      'Paralyzed man able to move, touch again with AI',
      'A Man With Paralysis Has Regained Feeling and Movement in His Hands After an Experimental Brain Implant',
    ]) expect(onTopicByLexicon(t(title)), title).toBe(true)
  })

  it('matches neural-data policy coverage', () => {
    expect(onTopicByLexicon(t('The battle for your brain data is underway, and CA may step in'))).toBe(true)
    expect(onTopicByLexicon(t('Neurodata on the regulatory radar: what the ICO’s citizens’ jury means'))).toBe(true)
  })

  it('matches spelled-out instrumentation, not only the acronym', () => {
    expect(onTopicByLexicon(t('Validation of a semi-dry electrode-based electroencephalography device'))).toBe(true)
  })

  it('matches the abbreviations trade press actually uses', () => {
    // "spinal cord stimulat…" missed all three of these.
    expect(onTopicByLexicon(t('Biotronik unveils new AI capability for spinal cord stim tech'))).toBe(true)
    expect(onTopicByLexicon(t('Lawsuits Challenge FDA Oversight of Spinal Cord Implants'))).toBe(true)
    expect(onTopicByLexicon(t('Living Human Brain Tissue Maps How Electric Stimulation Affects Neurons'))).toBe(true)
  })

  it('rejects unrelated medicine, business and consumer news', () => {
    for (const title of [
      'Feinstein Summer Concert Raises $3.5 Million to Advance Medical Research',
      'Global smartphone shipments rise 4% in the third quarter',
      'New study links diet to heart disease risk in older adults',
      'Stocks close higher as investors weigh inflation data',
    ]) expect(onTopicByLexicon(t(title)), title).toBe(false)
  })

  it('drops market-wire republishers even when they name a neurotech company', () => {
    // These pass any lexicon that lists company names, and are never the story.
    expect(onTopicByLexicon(t('Neuralink stock analysis', { source: 'Kalkine' }))).toBe(false)
    expect(onTopicByLexicon(t('Neuralink update', { source: 'TradingView' }))).toBe(false)
    // ...but the same headline from a real outlet still passes.
    expect(onTopicByLexicon(t('Neuralink implants its tenth patient', { source: 'Reuters' }))).toBe(true)
  })
})
