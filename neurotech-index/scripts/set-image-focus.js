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

const COMMIT = process.argv.includes('--commit')
const HERE = dirname(fileURLToPath(import.meta.url))
const FOCUS_PATH = join(HERE, '../src/data/image-focus.json')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'

/** The centre of the subject, as percentages of the frame. Null when the
 *  picture cannot be read, which leaves it centred. */
export async function findFocus(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const media = (res.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(jpeg|png|webp|gif)$/.test(media)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4_500_000) return null
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          { type: 'text', text: `Where is the MAIN SUBJECT of this photograph — the person, device, or object a viewer is meant to look at?

Answer with two integers from 0 to 100 separated by a comma: the horizontal centre of that subject as a percentage of the width, then the vertical centre as a percentage of the height. 0,0 is the top left; 100,100 is the bottom right; 50,50 is the middle.

If a person is the subject, use the centre of their head and shoulders, not their feet. Answer with the two numbers only, nothing else.` },
        ],
      }],
    })
    const m = /(\d{1,3})\s*,\s*(\d{1,3})/.exec(r.content?.[0]?.text || '')
    if (!m) return null
    const x = Math.min(100, Math.max(0, Number(m[1])))
    const y = Math.min(100, Math.max(0, Number(m[2])))
    return { x, y }
  } catch { return null }
}

// ── Every picture the site can show ─────────────────────────────────────────

const urls = new Map()   // url -> a label, for the log
const note = (url, label) => { if (url && !urls.has(url)) urls.set(url, label) }

for (const [id, c] of Object.entries(loadClassImages())) {
  for (const i of c.images) note(i.url, `${id}: ${String(i.classTitle || '').replace('File:', '').slice(0, 40)}`)
}
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('news_feed').select('title,metadata').range(from, from + 999)
  if (error) throw error
  if (!data.length) break
  for (const r of data) note(r.metadata?.image, String(r.title || '').slice(0, 44))
  if (data.length < 1000) break
}
const { data: devices } = await sb.from('devices').select('name,image_url').not('image_url', 'is', null).limit(1000)
for (const d of devices || []) note(d.image_url, String(d.name || '').slice(0, 44))
const { data: orgs } = await sb.from('organizations').select('name,image_url').not('image_url', 'is', null).limit(1000)
for (const o of orgs || []) note(o.image_url, String(o.name || '').slice(0, 44))
for (const n of JSON.parse(readFileSync(join(HERE, '../src/data/notable.json'), 'utf8'))) {
  note(n.image_url, String(n.title || '').slice(0, 44))
}

let focus = {}
try { focus = JSON.parse(readFileSync(FOCUS_PATH, 'utf8')) } catch { focus = {} }

const todo = [...urls.keys()].filter(u => !(u in focus))
console.log(`${urls.size} pictures in use, ${todo.length} without a focal point\n`)

let offCentre = 0
for (let i = 0; i < todo.length; i += 4) {
  const batch = todo.slice(i, i + 4)
  const found = await Promise.all(batch.map(findFocus))
  batch.forEach((url, k) => {
    const f = found[k]
    if (!f) { console.log(`  ·  unreadable        ${urls.get(url)}`); return }
    // A subject within a few percent of the middle is centred already, and an
    // entry for it would be noise in the file.
    const centred = Math.abs(f.x - 50) <= 6 && Math.abs(f.y - 50) <= 6
    if (!centred) { focus[url] = `${f.x}% ${f.y}%`; offCentre++ }
    console.log(`  ${centred ? '·' : '●'}  ${String(`${f.x},${f.y}`).padEnd(8)} ${urls.get(url)}`)
  })
}

console.log(`\n${offCentre} pictures need their crop moved off centre`)
if (COMMIT) {
  writeFileSync(FOCUS_PATH, JSON.stringify(focus, null, 2) + '\n')
  console.log(`Wrote src/data/image-focus.json (${Object.keys(focus).length} entries).`)
} else {
  console.log('Dry run. Re-run with --commit to write.')
}
