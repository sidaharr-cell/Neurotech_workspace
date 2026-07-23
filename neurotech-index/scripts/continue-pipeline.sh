#!/bin/zsh
# continue-pipeline.sh — finish the classification pipeline unattended.
#
# Waits for the MeSH database load to finish, then runs the remaining steps in
# order and logs everything. Runs locally with .env, so it needs no Claude usage
# and completes whether or not a session is active.
#
#   ./scripts/continue-pipeline.sh
#
# Deliberately does NOT delete anything — the Step 2 purge (632 duplicate device
# rows, code-excluded rows) still needs explicit approval.
#
# Note: the node invocation is written out in full at each call site on purpose.
# Holding it in a variable and calling `$NODE` fails under zsh, which does not
# word-split unquoted parameters — it looks for a command literally named
# "node --env-file-if-exists=.env".

cd "$(dirname "$0")/.." || exit 1
LOG="pipeline.log"

say() { printf '\n=== %s — %s ===\n' "$1" "$(date '+%H:%M:%S')" | tee -a "$LOG"; }
die() { printf '\nFAILED at: %s — %s\n' "$1" "$(date '+%H:%M:%S')" | tee -a "$LOG"; exit 1; }

printf 'pipeline started %s\n' "$(date)" >> "$LOG"

# ── Wait for the MeSH load to finish ────────────────────────────────────────
say "waiting for MeSH load to finish"
while pgrep -f "backfill-mesh.js --load" > /dev/null; do sleep 30; done
printf 'MeSH load finished\n' | tee -a "$LOG"

# ── Verify it landed before building anything on top of it ──────────────────
say "verifying MeSH"
node --env-file-if-exists=.env --input-type=module -e "
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const { data } = await sb.from('papers').select('mesh').order('id').limit(500)
const n = (data || []).filter(d => (d.mesh || []).length).length
console.log('sample of 500 papers: ' + n + ' carry MeSH')
if (n < 300) { console.error('MeSH looks under-loaded'); process.exit(1) }
" 2>&1 | tee -a "$LOG"
[[ ${pipestatus[1]} -eq 0 ]] || die "MeSH verification"

# ── Classify everything ─────────────────────────────────────────────────────
say "applying facets (papers)"
node --env-file-if-exists=.env scripts/apply-facets.js papers 2>&1 \
  | tr '\r' '\n' | grep -v "seen ·" | tee -a "$LOG"
[[ ${pipestatus[1]} -eq 0 ]] || die "apply-facets papers"

say "applying facets (patents devices trials news)"
node --env-file-if-exists=.env scripts/apply-facets.js patents devices trials news 2>&1 \
  | tr '\r' '\n' | grep -v "seen ·" | tee -a "$LOG"
[[ ${pipestatus[1]} -eq 0 ]] || die "apply-facets others"

# ── Labs and researchers inherit from their papers, so they come after ──────
say "rolling up labs and researchers"
node --env-file-if-exists=.env scripts/rollup-labs.js 2>&1 \
  | tr '\r' '\n' | tail -30 | tee -a "$LOG"
[[ ${pipestatus[1]} -eq 0 ]] || die "rollup-labs"

# ── Score ───────────────────────────────────────────────────────────────────
say "scoring the new classifier against the gold set"
node --env-file-if-exists=.env scripts/score-facets.js 2>&1 | tee -a "$LOG"
[[ ${pipestatus[1]} -eq 0 ]] || die "score-facets"

say "PIPELINE COMPLETE"
printf 'results: facet-scorecard.md · full log: pipeline.log\n' | tee -a "$LOG"
