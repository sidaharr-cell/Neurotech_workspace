import { createClient } from '@supabase/supabase-js'

/**
 * The anon, read-only client the pages read through.
 *
 * The env lookup has a second half, and it is not for the browser.
 *
 * Two scripts compose the home page through the page's own code — the binding
 * step and the home page check — so that what they record and what they assert
 * cannot drift from what a reader sees. Both run under vite-node, which means
 * both come through this module. In a terminal that works, because Vite reads
 * the project's `.env`. In CI it does not: `.env` is gitignored, the workflow
 * passes SUPABASE_URL and SUPABASE_SERVICE_KEY under their own names, and
 * `import.meta.env.VITE_SUPABASE_URL` is simply undefined.
 *
 * So the client came back null, the feed came back empty, and both steps
 * exited — quietly, because they are best-effort steps in scripts/daily.js and
 * a warning is all they are allowed to raise. The cost of that would have been
 * a night with no bindings written and a lead that stopped rotating, and the
 * only visible symptom would have been the front page not changing.
 *
 * Hence the fallback to `process.env`. It is reached only outside a browser:
 * `globalThis.process` is undefined in a bundle, and it is written that way
 * rather than as a bare `process.env` so Vite cannot statically replace it.
 * The service key is accepted last because these reads are reads — RLS allows
 * public select on every table, so the anon key is enough when there is one,
 * and in CI the service key is the only key present.
 */
const fromNode = name => globalThis.process?.env?.[name]

const url = import.meta.env.VITE_SUPABASE_URL || fromNode('VITE_SUPABASE_URL') || fromNode('SUPABASE_URL')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  || fromNode('VITE_SUPABASE_ANON_KEY')
  || fromNode('SUPABASE_ANON_KEY')
  || fromNode('SUPABASE_SERVICE_KEY')

// Returns null when env vars aren't set (local dev without Supabase)
export const supabase = url && key ? createClient(url, key) : null
