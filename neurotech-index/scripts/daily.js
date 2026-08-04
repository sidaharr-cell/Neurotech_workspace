/**
 * daily.js — the whole daily run, in the order it has to happen.
 *
 *   npm run daily
 *
 * This is the ONE definition of that order. It used to live only in
 * .github/workflows/refresh.yml as seventeen separate steps, which meant
 * `npm run refresh` — the obvious thing to type — ran the first of them and
 * nothing else. A run that looked complete would leave the day's new records
 * without pictures, because sourcing them is step ten. The workflow now calls
 * this script, so the cron and a person at a terminal do the same work.
 *
 * Failure policy matches what the workflow did, and for the same reason: one
 * dead upstream API must not stop the rest of the run, so every step is
 * best-effort EXCEPT the refresh itself, which is the run. A step that fails
 * is reported in the summary and sets the exit code, so "it went red" still
 * means something.
 *
 * Not included, deliberately: committing the data files and verify-cron.js.
 * Both stay in the workflow. The commit needs CI's git identity and secrets,
 * and verify-cron is the alarm that the run destroyed nothing — it is the last
 * word and belongs where it is visible as its own red X.
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * The sequence.
 *
 * `required` marks a step whose failure means the run did not happen at all.
 * Everything else is a repair or an enrichment: it can fail today and put
 * itself right tomorrow, because these steps are idempotent by construction.
 *
 * The image block's order is load-bearing and documented in CLAUDE.md:
 * the fit check clears stale assignments FIRST so the records it empties are
 * refilled in the same run; hand-placed pictures then beat the general
 * sources; the page fill runs last of the assigning steps so it can see what
 * is already spoken for and keep every card distinct; and the focus pass runs
 * after all of them, since it can only find a focal point for a picture that
 * has already been assigned.
 */
const STEPS = [
  { name: 'refresh (PubMed, arXiv, media, trials)', cmd: 'refresh.js', required: true },

  { name: 'companies (NeuroTechX Airtable)',        cmd: 'backfill-companies.js' },
  { name: 'labs (NIH RePORTER, NeuroTechX)',        cmd: 'backfill-labs.js' },
  { name: 'funding (SEC EDGAR, incremental)',       cmd: 'backfill-funding.js', args: ['--commit'] },
  { name: 'company status (SEC tickers)',           cmd: 'backfill-org-status.js', args: ['--commit'] },
  { name: 'inclusion decisions and modality',       cmd: 'backfill-inclusion.js', args: ['--commit'] },
  { name: 'furthest stage (openFDA, CT.gov)',       cmd: 'backfill-stage.js', args: ['--commit'] },
  { name: 'company publications',                   cmd: 'backfill-company-analytics.js' },

  // ── Images ────────────────────────────────────────────────────────────────
  { name: 'clear images that no longer fit',        cmd: 'verify-image-fit.js', args: ['--commit'] },
  { name: 'source images for new records',          cmd: 'backfill-images.js', args: ['--commit', '--limit=150'] },
  { name: 're-place the hand-picked pictures',      cmd: 'apply-card-images.js', args: ['--commit'] },
  { name: 'give every home card its own picture',   cmd: 'fill-page-images.js', args: ['--commit'] },
  { name: 'find focal points for new pictures',     cmd: 'set-image-focus.js', args: ['--commit'] },
  { name: 'clear rotted image links',               cmd: 'verify-images.js', args: ['--commit', '--stale-days=30', '--limit=300'] },

  // Last, because it judges the result of everything above: can each of the
  // home page's eight sections fill its slots, and does every story frame come
  // out with a picture in it? Both fail silently — nothing errors, the row is
  // just half empty and the frame holds a plate.
  { name: 'home page sections and pictures fill', cmd: 'verify-homepage.js', node: 'vite-node' },
]

/** PatentsView is key-gated; without one the step is skipped, not failed. */
function patentsStep() {
  if (!process.env.PATENTSVIEW_API_KEY) return null
  const since = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10)
  return { name: 'recent patents (PatentsView)', cmd: 'backfill-patents.js', env: { PATENTS_SINCE: since } }
}

function run(step) {
  return new Promise(resolve => {
    // A step marked `node: 'vite-node'` imports from src/, where imports are
    // extensionless and JSON is imported directly — Vite's resolution, which
    // plain node does not do. Running it through vite-node is what lets the
    // check share the page's own code instead of restating it and drifting.
    const argv = step.node === 'vite-node'
      ? [join(ROOT, 'node_modules/vite-node/vite-node.mjs'), join(HERE, step.cmd), ...(step.args || [])]
      : [join(HERE, step.cmd), ...(step.args || [])]
    const child = spawn(process.execPath, argv, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...(step.env || {}) },
    })
    child.on('close', code => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

const steps = [...STEPS, patentsStep()].filter(Boolean)
const results = []
let failedRequired = false

for (const step of steps) {
  // ::group:: makes each step a collapsible section in the Actions log, so
  // folding the sequence into one workflow step costs no readability there.
  console.log(`\n::group::${step.name}`)
  const started = Date.now()
  const code = await run(step)
  const secs = Math.round((Date.now() - started) / 1000)
  console.log('::endgroup::')

  results.push({ name: step.name, code, secs, required: !!step.required })
  if (code !== 0) {
    console.log(`  ${step.name} exited ${code}${step.required ? ' — this one is required' : ' (continuing)'}`)
    if (step.required) { failedRequired = true; break }
  }
}

console.log('\n─── daily run ───')
for (const r of results) {
  const mark = r.code === 0 ? '✓' : (r.required ? '✗' : '!')
  console.log(`  ${mark} ${String(r.secs).padStart(5)}s  ${r.name}`)
}

const failed = results.filter(r => r.code !== 0)
if (failedRequired) {
  console.log('\nA required step failed. The run did not happen.')
  process.exit(1)
}
if (failed.length) {
  // A warning, not a failure, and the distinction is load-bearing: the steps
  // AFTER this script in the workflow commit the data files it wrote and run
  // verify-cron, which is the alarm for a collapsed table. Exiting non-zero
  // here would skip both, so a dead upstream API would cost the day's
  // notable.json and image-focus.json and silence the one check that matters.
  // Whether the run was good is verify-cron's call, as it has been since the
  // 29 Jul 2026 data loss.
  for (const r of failed) console.log(`::warning::daily step failed (continuing): ${r.name}`)
  console.log(`\n${failed.length} best-effort step(s) failed. They are idempotent and retry tomorrow.`)
}
console.log(failed.length ? '\nRun finished with warnings.' : '\nAll steps completed.')
