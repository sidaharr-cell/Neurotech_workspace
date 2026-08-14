/**
 * Grouping for the "Recently changed" panel on the trials page.
 *
 * The trial_changes log is one row per field, so a single sync commonly writes
 * two rows for the same trial — status and enrollment move together when a
 * study closes. Listed raw, and with each row carrying the trial's name, the
 * second row reads as the panel printing the same trial twice. So the panel
 * lists trials, not changes, and stacks a trial's changes under one title.
 */

/** Trials the panel lists, and how many change rows to read to fill them. */
export const RECENT_TRIALS = 12
export const RECENT_CHANGES_FETCH = 60
/** Changes shown per trial before the rest collapse into a count. */
export const CHANGES_PER_TRIAL = 3

/**
 * Collapse newest-first change rows into one entry per trial, newest trial
 * first. Each entry carries the trial's title, its /item link target (null when
 * the trial is not in the index), the date it last changed, and its changes in
 * the order they arrived. Rows with nothing to group on are dropped.
 */
export function groupTrialChanges(changes = [], max = RECENT_TRIALS) {
  const byTrial = new Map()
  for (const c of changes) {
    // itemId first so a trial is one group even if a row is missing trial_id.
    const key = c.itemId || c.trial_id || c.nct_id
    if (!key) continue
    if (!byTrial.has(key)) {
      byTrial.set(key, { key, title: c.title, itemId: c.itemId ?? null, changedAt: c.changed_at, changes: [] })
    }
    byTrial.get(key).changes.push(c)
  }
  // Input is newest-first, so insertion order is already the order to show, and
  // each group's first row is its most recent change.
  return [...byTrial.values()].slice(0, max)
}
