import { describe, it, expect } from 'vitest'
import { groupTrialChanges, RECENT_TRIALS } from './trial-changes'

// Shaped like getRecentTrialChanges output: newest first, title/itemId resolved.
const change = (over = {}) => ({
  id: 'c1', trial_id: 't1', itemId: 't1', nct_id: 'NCT001', title: 'A Trial',
  field: 'status', old_value: 'RECRUITING', new_value: 'COMPLETED',
  changed_at: '2026-08-13T00:00:00Z', ...over,
})

describe('groupTrialChanges', () => {
  it('lists a trial once when one sync logs two fields for it', () => {
    const groups = groupTrialChanges([
      change({ id: 'c1', field: 'status' }),
      change({ id: 'c2', field: 'enrollment', old_value: '75', new_value: '80' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].changes.map(c => c.field)).toEqual(['status', 'enrollment'])
  })

  it('keeps distinct trials apart', () => {
    const groups = groupTrialChanges([
      change({ id: 'c1', trial_id: 't1', itemId: 't1', title: 'First' }),
      change({ id: 'c2', trial_id: 't2', itemId: 't2', title: 'Second' }),
    ])
    expect(groups.map(g => g.title)).toEqual(['First', 'Second'])
  })

  it('dates a group by its most recent change, not its oldest', () => {
    const [group] = groupTrialChanges([
      change({ id: 'c1', changed_at: '2026-08-13T00:00:00Z' }),
      change({ id: 'c2', changed_at: '2026-08-01T00:00:00Z' }),
    ])
    expect(group.changedAt).toBe('2026-08-13T00:00:00Z')
  })

  it('preserves newest-first order across trials', () => {
    const groups = groupTrialChanges([
      change({ id: 'c1', trial_id: 't1', itemId: 't1', title: 'Newest', changed_at: '2026-08-13T00:00:00Z' }),
      change({ id: 'c2', trial_id: 't2', itemId: 't2', title: 'Older', changed_at: '2026-08-10T00:00:00Z' }),
      change({ id: 'c3', trial_id: 't1', itemId: 't1', title: 'Newest', changed_at: '2026-08-09T00:00:00Z' }),
    ])
    // t1's second change must not promote it or split it into a third group.
    expect(groups.map(g => g.title)).toEqual(['Newest', 'Older'])
    expect(groups[0].changes).toHaveLength(2)
  })

  it('groups an unresolved trial by NCT id and offers no link', () => {
    const [group] = groupTrialChanges([
      change({ id: 'c1', itemId: null, trial_id: null, title: 'NCT404', nct_id: 'NCT404' }),
      change({ id: 'c2', itemId: null, trial_id: null, title: 'NCT404', nct_id: 'NCT404', field: 'enrollment' }),
    ])
    expect(group.itemId).toBeNull()
    expect(group.changes).toHaveLength(2)
  })

  it('drops a row with nothing to group on rather than merging such rows', () => {
    const groups = groupTrialChanges([
      change({ id: 'c1', itemId: null, trial_id: null, nct_id: null }),
      change({ id: 'c2', itemId: null, trial_id: null, nct_id: null }),
      change({ id: 'c3' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('t1')
  })

  it('caps at the trial count, counting trials rather than change rows', () => {
    // Two rows per trial: a cap counting rows would return half the trials.
    const many = Array.from({ length: RECENT_TRIALS * 2 }, (_, i) => [
      change({ id: `s${i}`, trial_id: `t${i}`, itemId: `t${i}`, field: 'status' }),
      change({ id: `e${i}`, trial_id: `t${i}`, itemId: `t${i}`, field: 'enrollment' }),
    ]).flat()
    expect(groupTrialChanges(many)).toHaveLength(RECENT_TRIALS)
  })

  it('returns nothing for no changes', () => {
    expect(groupTrialChanges([])).toEqual([])
    expect(groupTrialChanges()).toEqual([])
  })
})
