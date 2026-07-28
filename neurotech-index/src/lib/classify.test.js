import { describe, it, expect } from 'vitest'
import { classify } from './classify'

const paper = (title, abstract, mesh = []) => classify({ title, abstract, mesh }, 'papers')

describe('classify: incidental method keywords do not put a paper in scope', () => {
  it('excludes a non-neurotech paper that only mentions EEG/EMG as a method', () => {
    const r = paper('Hypothalamic MCH neurons links tau pathology to sleep disruption',
      'We recorded EEG and EMG to stage sleep in mice.')
    expect(r.in_scope).toBe(false)
    expect(r.facet_function).toEqual([])
  })
  it('excludes a disease study where a recording method and a disease word both appear (not a neurotech application)', () => {
    // EEG (records, a method) + Alzheimer (a disease studied, not a neurotech target)
    const r = paper('Hypothalamic MCH neurons links tau pathology to sleep disruption',
      'EEG and EMG were recorded. Relevance to Alzheimer disease is discussed.')
    expect(r.in_scope).toBe(false)
  })
  it('excludes an fMRI cognitive-neuroscience study that uses imaging only as a method', () => {
    expect(paper('Neural correlates of decision-making in the prefrontal cortex',
      'Functional MRI was used to measure brain activity.').in_scope).toBe(false)
  })
  it('excludes a paper whose neurotech term is a MINOR MeSH topic only', () => {
    const r = paper('Tau pathology and neuronal loss', 'used electroencephalography',
      [{ name: 'Electroencephalography', major: false }, { name: 'tau Proteins', major: true }])
    expect(r.in_scope).toBe(false)
  })
})

describe('classify: genuine neurotech papers stay in scope', () => {
  it('keeps a paper with the neurotech term in the title', () => {
    expect(paper('An EEG-based brain-computer interface for cursor control', '').in_scope).toBe(true)
    expect(paper('Deep brain stimulation for Parkinson disease', '').in_scope).toBe(true)
  })
  it('keeps a paper with two corroborating signals even if the title is generic', () => {
    expect(paper('Outcomes after therapy for chronic pain', 'Spinal cord stimulation reduced neuropathic pain.').in_scope).toBe(true)
  })
  it('keeps a paper whose neurotech term is a MAJOR MeSH topic', () => {
    expect(paper('Signal quality study', '', [{ name: 'Electroencephalography', major: true }]).in_scope).toBe(true)
  })
})
