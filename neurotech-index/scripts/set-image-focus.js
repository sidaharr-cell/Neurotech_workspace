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
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { loadClassImages } from './lib/images.js'
import { keptFraction, focusFor, frameFor } from '../src/lib/crop.js'

const COMMIT = process.argv.includes('--commit')
const HERE = dirname(fileURLToPath(import.meta.url))
const FOCUS_PATH = join(HERE, '../src/data/image-focus.json')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'

/** The subject's box, as percentages. Null when the picture cannot be read,
 *  which leaves it centred. */
export async function findSubjectBox(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const media = (res.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(jpeg|png|webp|gif)$/.test(media)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4_500_000) return null
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 40,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          { type: 'text', text: `Find the MAIN SUBJECT of this image — the person, device, or object a viewer is meant to look at. Ignore background, bench clutter, captions and whitespace.

Give its BOUNDING BOX as four integers from 0 to 100, separated by commas, in this order: left, top, right, bottom. These are percentages of the image's width and height. 0,0 is the top left corner; 100,100 is the bottom right.

Be tight: the box should contain the subject and as little else as possible. If a person is the subject, box their head and torso, not their feet. If the subject is a multi-panel figure or a diagram with no single focus, box the whole image (0,0,100,100).

Answer with the four numbers only, nothing else.` },
        ],
      }],
    })
    const m = /(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(r.content?.[0]?.text || '')
    if (!m) return null
    const n = i => Math.min(100, Math.max(0, Number(m[i]))) / 100
    const [left, top, right, bottom] = [n(1), n(2), n(3), n(4)]
    if (right <= left || bottom <= top) return null
    return { left, top, right, bottom }
  } catch { return null }
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

let offCentre = 0, unread = 0
for (let i = 0; i < todo.length; i += 4) {
  const batch = todo.slice(i, i + 4)
  const found = await Promise.all(batch.map(findSubjectBox))
  batch.forEach((url, k) => {
    const meta = urls.get(url)
    const box = found[k]
    if (!box) { unread++; console.log(`  ·  unreadable          ${meta.label}`); return }
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
  })
}

console.log(`\n${offCentre} pictures need their crop moved off centre, ${unread} could not be read`)
if (COMMIT) {
  writeFileSync(FOCUS_PATH, JSON.stringify(focus, null, 2) + '\n')
  console.log(`Wrote src/data/image-focus.json (${Object.keys(focus).length} entries).`)
} else {
  console.log('Dry run. Re-run with --commit to write.')
}
