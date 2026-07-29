import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { validate } from './validate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(
  readFileSync(join(__dirname, '../../scripts/data/section8-cases.json'), 'utf8'))

/** Read a dotted path like "FD.score" out of a score object. */
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

/**
 * Phase 4 accepts when "all validation rules in Section 8 fire correctly on
 * constructed adversarial cases". This is that test.
 *
 * The cases were written from the spec text before validate.js existed, so this
 * is a real check rather than a mirror of the implementation. Cases are run
 * individually and named, so a failure says which rule and which case.
 *
 * NEUTRAL CONTEXT. Each case isolates ONE rule and supplies only the fields that
 * rule reads. The full validator still runs over it, so a rule the case never
 * meant to exercise would otherwise fire on an absent field: every rule 5 case
 * failed initially because no case mentions frontier_records_consulted, so rule
 * 4 zeroed FD before rule 5 could see it. That behaviour is CORRECT in
 * production, so the fix is to give the untested rules a neutral value rather
 * than to weaken them. The case's own values always win, so rule 4's cases still
 * set the field themselves.
 */
const NEUTRAL_CONTEXT = { frontier_records_consulted: ['ctx-record'] }
const withContext = input => ({ ...NEUTRAL_CONTEXT, ...input })
describe('section 8 validators against the pre-written adversarial corpus', () => {
  for (const c of corpus.cases) {
    const label = `rule ${c.rule}: ${c.name}`

    if (c.expect.must_not_fire) {
      it(`${label} — must NOT fire`, () => {
        const { score, resets } = validate(withContext(c.input))
        const fired = resets.filter(r => r.rule === c.rule)
        expect(fired, `${c.why}\nfired: ${JSON.stringify(fired)}`).toHaveLength(0)
        // The relevant values must be untouched too, not merely unlogged.
        for (const dim of ['FD', 'LV', 'TR', 'GAP', 'GATE', 'METH']) {
          if (c.input[dim]?.score !== undefined) {
            expect(score[dim].score, `${dim} changed`).toBe(c.input[dim].score)
          }
        }
        if (c.input.record_update_proposed) expect(score.record_update_proposed).toBeTruthy()
        if (c.input.user_facing_reason) expect(score.needs_regeneration).toBeFalsy()
      })
      continue
    }

    if (c.expect.reset) {
      it(`${label} — resets`, () => {
        const { score, resets } = validate(withContext(c.input))
        for (const [path, want] of Object.entries(c.expect.reset)) {
          expect(at(score, path), `${c.why}\n${path}`).toEqual(want)
        }
        expect(resets.some(r => r.rule === c.rule), `${c.why}\nno reset logged for rule ${c.rule}`).toBe(true)
      })
      continue
    }

    if (c.expect.regenerate) {
      it(`${label} — flags for regeneration`, () => {
        const { score, resets } = validate(withContext(c.input))
        expect(score.needs_regeneration, c.why).toBe(true)
        expect(resets.some(r => r.rule === 7)).toBe(true)
      })
      continue
    }

    if (c.expect.fallback_to_template) {
      it(`${label} — falls back to a template`, () => {
        const { score } = validate(withContext(c.input))
        expect(score.reason_from_template, c.why).toBe(true)
        expect(score.user_facing_reason).not.toMatch(/rubric|frontier delta/i)
        expect(score.user_facing_reason.length).toBeGreaterThan(0)
      })
    }
  }
})

describe('the reset log is usable as the monitoring signal spec 8 asks for', () => {
  it('records the rule number, the field and the original value', () => {
    const { resets } = validate(
      { FD: { score: 3, referent: '' } }, { itemId: 'item-1' })
    expect(resets[0]).toMatchObject({ item_id: 'item-1', rule: 1, field: 'FD.score', from: 3, to: 0 })
    expect(resets[0].note).toBeTruthy()
  })

  it('never mutates the score it was given', () => {
    const input = { FD: { score: 3, referent: '' } }
    validate(input)
    expect(input.FD.score).toBe(3)
  })

  it('reports every rule that fired, not just the first', () => {
    const { resets } = validate({
      FD: { score: 4, referent: '', paired_axes: [] },
      LV: { score: 3, referent: 'a real referent', beneficiaries: [] },
      GATE: { score: 3, referent: 'a real referent', unlocks: ['help patients'] },
      frontier_records_consulted: [],
    })
    expect([...new Set(resets.map(r => r.rule))].sort()).toEqual([1, 2, 3])
  })
})
