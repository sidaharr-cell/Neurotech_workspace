/**
 * review-queue.js — the reviewer's desk.
 *
 *   node scripts/review-queue.js                          # what is waiting
 *   node scripts/review-queue.js --fetch --out=DIR        # download them to look at
 *   node scripts/review-queue.js --apply=DECISIONS.json   # write the verdicts
 *
 * The pipeline finds pictures; it does not judge them. Everything it finds and
 * has no ruling on lands in the queue in src/data/image-review.json, and this
 * is the three-step loop that empties it:
 *
 *   list    what is waiting, and which story wanted it
 *   fetch   the files, written to a directory, with a manifest naming each one.
 *           A reviewer cannot judge a URL. They have to see the picture, which
 *           means it has to be on disk.
 *   apply   the verdicts, as JSON, merged into the decisions and dropped from
 *           the queue.
 *
 * The reviewer is the daily agent described in
 * `.claude/skills/refresh-home-images`. It could equally be a person with an
 * image viewer and a text editor; the format is deliberately plain so that
 * stays true. What it must not be is a model called from inside the pipeline,
 * which is the arrangement this replaced.
 *
 * A decisions file is an array:
 *
 *   [{ "url": "...", "photo": true, "single": true, "safe": true, "depicts": true,
 *      "box": { "left": 0.2, "top": 0.1, "right": 0.8, "bottom": 0.9 },
 *      "note": "EEG cap on a seated participant, centre-left" }]
 *
 * All four booleans must be true for the picture to be publishable, and all
 * four are recorded either way — a "no" is a decision, and recording it is
 * what stops the same rejected picture coming back round every night.
 *
 * `depicts` is the one that is easy to skip and the one the home page turns
 * on: is this a picture OF the story it was queued for? The manifest carries
 * that story's title next to the file so the question can actually be
 * answered. See the note in scripts/lib/review.js for what got through before
 * this field existed.
 *
 * `box` is the subject's EXTENT as fractions of width and height, not a centre
 * point, because src/lib/crop.js needs an extent to guarantee the subject
 * survives the crop rather than merely sits near the middle of it. It is
 * optional; without one the picture is centred.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { load, save, decide, pending, verdict } from './lib/review.js'
import { keyOf } from '../src/lib/ledger.js'

const arg = name => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return null
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true
}

const LIMIT = Number(arg('limit') || 25)
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'

let store = load()

// ── apply ───────────────────────────────────────────────────────────────────

const applyPath = arg('apply')
if (applyPath && applyPath !== true) {
  const rows = JSON.parse(readFileSync(applyPath, 'utf8'))
  if (!Array.isArray(rows)) { console.error('a decisions file is an array of decisions'); process.exit(1) }
  const at = new Date().toISOString().slice(0, 10)
  // Every URL in a decisions file has to be one that was actually asked about.
  // A reviewer works from a manifest and writes JSON by hand, and a URL that is
  // retyped rather than copied comes out subtly wrong — a different crop
  // segment, a dropped query parameter. That recorded a verdict against a
  // picture that does not exist and left the real one unreviewed and invisible,
  // which is the one failure mode this whole file is supposed to prevent.
  const known = new Set([
    ...(store.pending || []).map(p => keyOf(p.url)),
    ...Object.keys(store.decisions || {}),
  ])
  const unknown = rows.filter(r => r?.url && !known.has(keyOf(r.url)))
  if (unknown.length) {
    console.error(`${unknown.length} decision(s) name a picture that was never queued:`)
    for (const r of unknown) console.error(`  ${r.url}`)
    console.error('\nCopy the url from the manifest rather than retyping it. Nothing was written.')
    process.exit(1)
  }
  let yes = 0, no = 0
  for (const r of rows) {
    if (!r?.url) { console.error('skipping a decision with no url'); continue }
    store = decide(store, r.url, { ...r, at })
    if (r.photo && r.single && r.safe && r.depicts) yes++; else no++
  }
  save(store)
  console.log(`${rows.length} decision(s) recorded: ${yes} publishable, ${no} turned down`)
  console.log(`${(store.pending || []).length} picture(s) still waiting`)
  process.exit(0)
}

// ── fetch ───────────────────────────────────────────────────────────────────

const outDir = arg('out')
if (arg('fetch')) {
  if (!outDir || outDir === true) { console.error('--fetch needs --out=DIR'); process.exit(1) }
  mkdirSync(outDir, { recursive: true })
  const todo = pending(store, LIMIT)
  const manifest = []
  for (const [i, p] of todo.entries()) {
    let file = null, note = null
    try {
      const res = await fetch(p.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
      const type = (res.headers.get('content-type') || '').split(';')[0]
      if (!res.ok) note = `HTTP ${res.status}`
      else if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) note = `not an image (${type || 'unknown'})`
      else {
        const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[type]
          || extname(new URL(p.url).pathname) || '.jpg'
        file = join(outDir, `${String(i).padStart(3, '0')}${ext}`)
        writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      }
    } catch (e) { note = String(e.message || e).slice(0, 80) }
    manifest.push({ i, file, url: p.url, item: p.item, title: p.title, why: p.why, note })
  }
  // A picture that cannot be fetched cannot be judged, and leaving it queued
  // means fetching it again tomorrow. It is recorded as a no with the reason:
  // an unreachable file is not publishable, which is the honest verdict.
  const unreachable = manifest.filter(m => !m.file)
  for (const m of unreachable) {
    store = decide(store, m.url, { photo: false, single: false, safe: false, depicts: false, note: `unreachable: ${m.note}`, at: new Date().toISOString().slice(0, 10) })
  }
  if (unreachable.length) save(store)

  const manifestPath = join(outDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest.filter(m => m.file), null, 2) + '\n')
  console.log(`${manifest.length - unreachable.length} picture(s) written to ${outDir}`)
  if (unreachable.length) console.log(`${unreachable.length} could not be fetched and were recorded as unpublishable`)
  console.log(`manifest: ${manifestPath}`)
  process.exit(0)
}

// ── list ────────────────────────────────────────────────────────────────────

const queue = pending(store)
const decisions = Object.values(store.decisions || {})
console.log(`\n${queue.length} picture(s) waiting, ${decisions.length} already decided`)
console.log(`  ${decisions.filter(d => d.photo && d.single && d.safe && d.depicts).length} of those are publishable\n`)
for (const p of pending(store, LIMIT)) {
  console.log(`  ${String(p.why || '').padEnd(28)} ${String(p.title || p.item || '').slice(0, 44).padEnd(46)} ${p.url.slice(0, 60)}`)
}
if (queue.length > LIMIT) console.log(`\n  … and ${queue.length - LIMIT} more (--limit=N)`)
if (!queue.length) console.log('  nothing waiting.')

const url = arg('verdict')
if (url && url !== true) console.log(`\n${url}\n`, verdict(store, url))
