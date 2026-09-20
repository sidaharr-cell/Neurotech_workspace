import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const labs = JSON.parse(
  readFileSync(resolve(__dir, 'data/neurotechx-academic-labs.json'), 'utf8'),
)

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

/** This asserts the published snapshot rather than the helper in
 *  backfill-labs.js, and it does so deliberately.
 *
 *  The NeuroTechX Airtable carries stray contact addresses in columns that do
 *  not mean an address — a PI's email arrived in `pi`, in `website`, in
 *  `faculty`. `loadAcademicLabs` refetches that sheet on every nightly run and
 *  OVERWRITES this file, which the refresh workflow then commits. So a guard
 *  that only held at the helper would be one upstream edit away from putting a
 *  real person's address back into a public repository.
 *
 *  Importing the script is not an option either: backfill-labs.js calls run()
 *  at module load. The artifact is the thing that ships, CI runs on the bot's
 *  data commit, and this is what makes CI notice. */
describe('academic lab snapshot', () => {
  it('publishes no contact email addresses', () => {
    const offenders = labs.flatMap(lab =>
      Object.entries(lab)
        .filter(([, v]) => typeof v === 'string' && EMAIL.test(v.trim()))
        .map(([field, v]) => `${lab.labName} — ${field}=${v}`),
    )
    expect(offenders).toEqual([])
  })

  /** The guard drops values; it must not drop records. A snapshot that got
   *  emptied would also pass the test above. */
  it('still carries the full lab list', () => {
    expect(labs.length).toBeGreaterThan(700)
    expect(labs.every(lab => lab.labName)).toBe(true)
  })
})
