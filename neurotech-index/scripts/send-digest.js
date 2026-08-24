/**
 * send-digest.js — mail "What's new today" to whoever asked for it.
 *
 *   node --env-file-if-exists=.env node_modules/vite-node/vite-node.mjs \
 *        scripts/send-digest.js [--commit] [--limit=N] [--to=you@example.com]
 *
 * DRY RUN BY DEFAULT. Without --commit this prints the subject line, the
 * recipient count and the plain-text body, and sends nothing. Every script here
 * that writes to production is dry-run by default; this one writes to other
 * people's inboxes, which is the one kind of write that cannot be undone by
 * running the job again.
 *
 * IT RUNS THROUGH vite-node because the digest is composed by the PAGE'S own
 * code — src/lib/whatsNew.js, the same module the "What's new today?" window
 * reads. That is the point: the mail and the window are one definition, so a
 * reader who opens both cannot be shown two different days. bind-home-images.js
 * runs this way for the same reason.
 *
 * NO MODEL API. The two-sentence TLDRs are extractive, taken from the summary
 * and significance text the daily run has already written. Nothing in this
 * script calls Anthropic or any other model, and nothing in it should ever
 * start to: a per-item summariser here would bill the run again for prose that
 * is already in the row.
 *
 * WITHOUT A MAIL PROVIDER IT SKIPS, LOUDLY BUT SUCCESSFULLY. RESEND_API_KEY and
 * DIGEST_FROM are what turn sending on. Absent either, the script says so with
 * a ::warning:: and exits 0, because it is a best-effort step in scripts/daily.js
 * and one unset secret must not turn the nightly run red.
 */
import { createClient } from '@supabase/supabase-js'
import { fetchWhatsNew, digestHtml, digestText, digestSubject, SUBSCRIBERS_TABLE } from '../src/lib/whatsNew.js'

const argOf = (name, fallback = null) =>
  (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || fallback

const COMMIT = process.argv.includes('--commit')
const LIMIT = Number(argOf('limit', 500))
const ONLY = argOf('to')                                   // one address, for a test send
const ORIGIN = process.env.SITE_ORIGIN || 'https://neurobase-live.vercel.app'
const FROM = process.env.DIGEST_FROM                       // e.g. "NeuroBase <digest@yourdomain>"
const RESEND_KEY = process.env.RESEND_API_KEY

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('::warning::send-digest: no SUPABASE_URL / SUPABASE_SERVICE_KEY, nothing to send')
  process.exit(0)
}

// The service key, explicitly. digest_subscribers has an insert policy and no
// select policy on purpose (migration 025), so the anon client the page uses
// cannot read this list — and must not be able to.
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

/** Everyone still on the list, oldest first. */
async function recipients() {
  if (ONLY) return [{ id: null, email: ONLY }]
  const { data, error } = await sb
    .from(SUBSCRIBERS_TABLE)
    .select('id,email')
    .is('unsubscribed_at', null)
    .order('created_at', { ascending: true })
    .limit(LIMIT)
  if (error) {
    // A missing table is the ordinary state before migration 025 is applied,
    // and it is not a reason to fail the nightly run.
    console.log(`::warning::send-digest: could not read subscribers (${error.message})`)
    return []
  }
  return data || []
}

/**
 * One message, through Resend's HTTP API.
 *
 * Chosen because it is a POST with a JSON body: no new dependency in a project
 * that has no server and no mail library, and nothing to keep up to date. Any
 * provider with a similar endpoint could stand in here; only this function
 * knows which one it is.
 */
async function send({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

const digest = await fetchWhatsNew(sb)
const subject = digestSubject(digest)
const text = digestText(digest, { origin: ORIGIN })
const html = digestHtml(digest, { origin: ORIGIN })

console.log(`\nWhat's new today — ${digest.day}`)
for (const s of digest.sections) console.log(`  ${String(s.items.length).padStart(4)}  ${s.label}`)
console.log(`  ${String(digest.total).padStart(4)}  in total`)

// An empty day is a real answer for the window ("nothing yet") and a bad mail.
// Nobody subscribed to be told that the run found nothing.
if (!digest.total) {
  console.log('\nNothing new today; no mail sent.')
  process.exit(0)
}

const list = await recipients()
console.log(`\n${list.length} subscriber(s)`)
if (!list.length) process.exit(0)

if (!COMMIT) {
  console.log('\nDry run. Re-run with --commit to send. The mail would read:\n')
  console.log(`  Subject: ${subject}`)
  console.log(text.split('\n').map(l => `  ${l}`).join('\n'))
  process.exit(0)
}

if (!RESEND_KEY || !FROM) {
  console.log('::warning::send-digest: RESEND_API_KEY and DIGEST_FROM are not set, so nothing was sent')
  process.exit(0)
}

let sent = 0
const failed = []
for (const r of list) {
  try {
    await send({ to: r.email, subject, html, text })
    sent++
    // Stamped per recipient rather than per run, so a send that dies halfway
    // leaves a record of exactly how far it got.
    if (r.id) await sb.from(SUBSCRIBERS_TABLE).update({ last_sent_at: new Date().toISOString() }).eq('id', r.id)
  } catch (e) {
    failed.push(`${r.email}: ${e.message}`)
  }
}

console.log(`\nsent ${sent}/${list.length}`)
for (const f of failed.slice(0, 10)) console.log(`  ! ${f}`)
if (failed.length) console.log(`::warning::send-digest: ${failed.length} message(s) failed`)
