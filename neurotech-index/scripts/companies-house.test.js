import { describe, it, expect } from 'vitest'
import { pickCompany } from './backfill-companies-house.js'

const entry = (title, over = {}) => ({
  title, company_number: '01234567', company_status: 'active',
  date_of_creation: '2011-04-05', ...over,
})

describe('pickCompany', () => {
  it('matches across legal suffixes and casing', () => {
    expect(pickCompany('Acme Neuro', [entry('ACME NEURO LIMITED')])?.company_number).toBe('01234567')
    expect(pickCompany('Acme Neuro Ltd', [entry('Acme Neuro Limited')])).toBeTruthy()
  })

  /** The rule that stops "Aura" becoming "Aura Group", which cost this repo
   *  $205M on the funding chart once. `core` keeps name-distinguishing words. */
  it('does not match a bigger namesake', () => {
    expect(pickCompany('Aura', [entry('AURA GROUP LIMITED')])).toBe(null)
    expect(pickCompany('Neuros Medical', [entry('NEUROS CORP LIMITED')])).toBe(null)
  })

  it('refuses to choose when two entries share the name', () => {
    const two = [entry('ACME NEURO LTD', { company_number: '1' }), entry('Acme Neuro Limited', { company_number: '2' })]
    expect(pickCompany('Acme Neuro', two)).toBe(null)
  })

  it('prefers a live company over a dissolved namesake', () => {
    const mixed = [
      entry('ACME NEURO LTD', { company_number: 'dead', company_status: 'dissolved' }),
      entry('Acme Neuro Limited', { company_number: 'live' }),
    ]
    expect(pickCompany('Acme Neuro', mixed)?.company_number).toBe('live')
  })

  it('still takes a dissolved company when it is the only one', () => {
    expect(pickCompany('Acme Neuro', [entry('ACME NEURO LTD', { company_status: 'dissolved' })])).toBeTruthy()
  })

  it('ignores an entry with no incorporation date', () => {
    expect(pickCompany('Acme Neuro', [entry('ACME NEURO LTD', { date_of_creation: null })])).toBe(null)
  })

  it('has nothing to say about an empty or unnamed search', () => {
    expect(pickCompany('Acme Neuro', [])).toBe(null)
    expect(pickCompany('', [entry('ACME NEURO LTD')])).toBe(null)
  })
})
