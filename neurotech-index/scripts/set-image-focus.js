/**
 * set-image-focus.js — find what each picture is OF, and where it sits.
 *
 *   node --env-file-if-exists=.env scripts/set-image-focus.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/set-image-focus.js --commit
 *
 * Cards are landscape and fill by cropping, and a crop takes the middle. That
 * is wrong whenever the subject is not in the middle: a prosthetic arm along
 * the bottom edge, a patient sitting to one side of a scanner, a wordmark
 * hard left. The middle of the FRAME is not the middle of the SUBJECT.
 *
 * So each picture is asked where its subject is, and the answer is stored as a
 * focal point in src/data/image-focus.json, which the page hands to CSS
 * object-position. An image with no entry keeps the default centre, so the
 * file only ever needs to hold the ones that differ.
 *
 * Keyed by URL rather than by record, because the same photograph carries the
 * same subject wherever it runs.
 *
 * WHERE THE ANSWER COMES FROM changed on 23 Aug 2026. It used to be a vision
 * call per picture per night. It is now the `box` recorded against that picture
 * in src/data/image-review.json by the daily reviewer — the same pass that
 * decides whether the picture may be published at all, which is the natural
 * place for it: both questions are answered by looking at the picture once.
 * This script no longer calls anything; it reads boxes and does the geometry.
 *
 * A picture with no box stays centred and is queued, so tomorrow's run has it.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { loadClassImages } from './lib/images.js'
import { load as loadReview, save as saveReview, box as boxFor, queue as queueForReview } from './lib/review.js'
import { keptFraction, focusFor, frameFor } from '../src/lib/crop.js'

const COMMIT = process.argv.includes('--commit')
const HERE = dirname(fileURLToPath(import.meta.url))
const FOCUS_PATH = join(HERE, '../src/data/image-focus.json')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

/**
 * The subject's box, as fractions of the picture's width and height.
 *
 * Read from the reviewed decisions. Null means nobody has given this picture a
 * box, which leaves it centred — the same outcome the old vision call gave on
 * an image it could not read, so nothing downstream had to change.
 */
export function findSubjectBox(store, url) {
  const b = boxFor(store, url)
  if (!b) return null
  const n = v => Math.min(1, Math.max(0, Number(v)))
  const [left, top, right, bottom] = [n(b.left), n(b.top), n(b.right), n(b.bottom)]
  if (!(right > left) || !(bottom > top)) return null
  return { left, top, right, bottom }
}

// ── Every picture the site can show ─────────────────────────────────────────

const urls = new Map()   // url -> { label, w, h }
const note = (url, label, w, h) => { if (url && !urls.has(url)) urls.set(url, { label, w: w || null, h: h || null }) }

for (const [id, c] of Object.entries(loadClassImages())) {
  for (const i of c.images) note(i.url, `${id}: ${String(i.classTitle || '').replace('File:', '').slice(0, 40)}`, i.w, i.h)
}
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('news_feed').select('title,metadata').range(from, from + 999)
  if (error) throw error
  if (!data.length) break
  for (const r of data) note(r.metadata?.image, String(r.title || '').slice(0, 44), r.metadata?.imageW, r.metadata?.imageH)
  if (data.length < 1000) break
}
const { data: devices } = await sb.from('devices').select('name,image_url,image_w,image_h').not('image_url', 'is', null).limit(1000)
for (const d of devices || []) note(d.image_url, String(d.name || '').slice(0, 44), d.image_w, d.image_h)
const { data: orgs } = await sb.from('organizations').select('name,image_url,image_w,image_h').not('image_url', 'is', null).limit(1000)
for (const o of orgs || []) note(o.image_url, String(o.name || '').slice(0, 44), o.image_w, o.image_h)
for (const n of JSON.parse(readFileSync(join(HERE, '../src/data/notable.json'), 'utf8'))) {
  note(n.image_url, String(n.title || '').slice(0, 44), n.image_w, n.image_h)
}

let focus = {}
try { focus = JSON.parse(readFileSync(FOCUS_PATH, 'utf8')) } catch { focus = {} }

// The cards this has to satisfy are 4:3 and 16:9. A position is computed for
// the tighter of the two — 4:3 keeps less of a wide picture, 16:9 keeps less of
// a tall one — so whichever frame a picture lands in, its subject is held.
/**
 * Recompute a picture whose crop is severe enough for the answer to matter.
 *
 * Entries written before this took the subject's EXTENT into account hold a
 * centre point, which is the right answer only when the subject is small. The
 * ones worth paying to re-read are those losing a real share of an axis; a
 * picture close to the frame's own shape barely crops, so its stored position
 * is as good as a new one.
 */
const SEVERE = 0.9
const severity = u => {
  const { w, h } = urls.get(u)
  if (!w || !h) return 1
  const f = keptFraction(w, h, frameFor(w, h))
  return Math.min(f.x, f.y)
}
const RECOMPUTE = process.argv.includes('--recompute-crops')
const todo = [...urls.keys()].filter(u => !(u in focus) || (RECOMPUTE && severity(u) < SEVERE))
console.log(`${urls.size} pictures in use, ${todo.length} to read`)
if (RECOMPUTE) console.log(`  (recomputing every picture that loses more than ${Math.round((1 - SEVERE) * 100)}% of an axis)\n`)
else console.log('')

let review = loadReview()
let offCentre = 0, unread = 0, queued = 0
const TODAY = new Date().toISOString().slice(0, 10)
for (const url of todo) {
  const meta = urls.get(url)
  const box = findSubjectBox(review, url)
  // No box yet. The picture stays centred and goes on the reviewer's list; a
  // centred crop is a fair default and a wrong one is the thing this script
  // exists to fix, so it is worth one day's wait rather than a guess.
  if (!box) {
    unread++
    const before = review.pending.length
    review = queueForReview(review, url, { title: meta.label, why: 'where is the subject', at: TODAY })
    if (review.pending.length > before) queued++
    console.log(`  ·  no box yet          ${meta.label}`)
    continue
  }
  {
    const frame = frameFor(meta.w, meta.h)
    const { x, y } = focusFor(box, meta.w, meta.h, frame)
    // A position within a few percent of the middle IS the default, so storing
    // it would be noise. Anything else is stored, including for pictures that
    // already had an entry: this reading knows the subject's extent and the
    // shape of the frame, and the one it replaces knew neither.
    const centred = Math.abs(x - 50) <= 3 && Math.abs(y - 50) <= 3
    if (centred) delete focus[url]
    else { focus[url] = `${x}% ${y}%`; offCentre++ }
    const keep = keptFraction(meta.w, meta.h, frame)
    const tight = Math.round(Math.min(keep.x, keep.y) * 100)
    console.log(`  ${centred ? '·' : '●'}  ${String(`${x}% ${y}%`).padEnd(10)} keeps ${String(tight + '%').padEnd(5)} ${meta.label}`)
  }
}

console.log(`\n${offCentre} pictures need their crop moved off centre, ${unread} have no box yet (${queued} queued for review)`)
if (COMMIT) {
  writeFileSync(FOCUS_PATH, JSON.stringify(focus, null, 2) + '\n')
  saveReview(review)
  console.log(`Wrote src/data/image-focus.json (${Object.keys(focus).length} entries).`)
} else {
  console.log('Dry run. Re-run with --commit to write.')
}
