import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(__dirname, 'data/section8-cases.json'), 'utf8'))
const RULES = ['1', '2', '3', '4', '5', '6', '7', '8']

/**
 * These test the CORPUS, not the validators, which do not exist yet. The corpus
 * is written first on purpose (see its _readme), so it needs its own guard
 * against rotting or quietly losing coverage as Phase 4 lands.
 */
describe('the section 8 corpus covers every rule', () => {
  it('quotes all eight rules from the spec', () => {
    expect(Object.keys(corpus.rules).sort()).toEqual(RULES)
    for (const [n, text] of Object.entries(corpus.rules)) {
      expect(text, `rule ${n} text`).toBeTruthy()
      expect(text.length, `rule ${n} text`).toBeGreaterThan(30)
    }
  })

  it.each(RULES)('has at least one case for rule %s', (rule) => {
    expect(corpus.cases.filter(c => String(c.rule) === rule).length).toBeGreaterThan(0)
  })

  it.each(RULES)('has at least one MUST-FIRE case for rule %s', (rule) => {
    const fire = corpus.cases.filter(c => String(c.rule) === rule && !c.expect.must_not_fire)
    expect(fire.length, `rule ${rule} has no case that requires the validator to act`).toBeGreaterThan(0)
  })

  it.each(RULES)('has at least one MUST-NOT-FIRE case for rule %s', (rule) => {
    // A validator that resets everything passes every positive case and
    // destroys the sort. Over-fire guards are what catch that, so every rule
    // needs one and losing them must break the build.
    const guard = corpus.cases.filter(c => String(c.rule) === rule && c.expect.must_not_fire)
    expect(guard.length, `rule ${rule} has no over-fire guard`).toBeGreaterThan(0)
  })
})

describe('every case is complete enough to run', () => {
  it('names a rule, a case, a reason, an input and an expectation', () => {
    for (const c of corpus.cases) {
      expect(RULES, `case "${c.name}" rule`).toContain(String(c.rule))
      expect(c.name, 'case name').toBeTruthy()
      expect(c.why, `case "${c.name}" why`).toBeTruthy()
      expect(c.input, `case "${c.name}" input`).toBeTruthy()
      expect(c.expect, `case "${c.name}" expect`).toBeTruthy()
    }
  })

  it('states exactly one kind of expected outcome', () => {
    const kinds = ['reset', 'unchanged', 'regenerate', 'fallback_to_template']
    for (const c of corpus.cases) {
      const present = kinds.filter(k => c.expect[k] !== undefined)
      expect(present.length, `case "${c.name}" declares ${present.length} outcomes`).toBe(1)
    }
  })

  it('pairs every unchanged expectation with must_not_fire', () => {
    for (const c of corpus.cases) {
      if (c.expect.unchanged) {
        expect(c.expect.must_not_fire, `case "${c.name}" is unchanged but not marked must_not_fire`).toBe(true)
      }
    }
  })

  it('gives every case a distinct name', () => {
    const names = corpus.cases.map(c => `${c.rule}:${c.name}`)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the cases the spec names explicitly are present', () => {
  const hasCase = pred => corpus.cases.some(pred)

  it.each(['advance the field', 'help patients', 'improve outcomes'])(
    'covers the rejected generic string %s', (phrase) => {
      // Spec rule 3 names these three verbatim as the reject list.
      expect(hasCase(c => JSON.stringify(c.input).includes(phrase))).toBe(true)
    })

  it('covers FD 3 where records were consulted but none matched', () => {
    // The subtle rule-4 case: without it a validator can make FD 3 permanently
    // unreachable by reading "no matching record" as "no records consulted".
    expect(hasCase(c => String(c.rule) === '4' && c.expect.must_not_fire
      && (c.input.frontier_records_consulted || []).length > 0)).toBe(true)
  })

  it('covers leverage used as ordinary English rather than rubric vocabulary', () => {
    expect(hasCase(c => String(c.rule) === '7' && c.expect.must_not_fire
      && /leverag/i.test(c.input.user_facing_reason || ''))).toBe(true)
  })

  it('covers the regeneration attempt cap', () => {
    expect(hasCase(c => c.expect.fallback_to_template === true)).toBe(true)
  })

  it('covers a registered trial that has not reported', () => {
    expect(hasCase(c => String(c.rule) === '8' && c.input.entity_type === 'trial'
      && c.expect.must_not_fire)).toBe(true)
  })
})
