/**
 * fill-page-images.js — give every card on the home page its own picture.
 *
 *   node --env-file-if-exists=.env scripts/fill-page-images.js            # DRY RUN
 *   node --env-file-if-exists=.env scripts/fill-page-images.js --commit
 *
 * The class pipeline assigns by technology, which leaves records stranded when
 * their technology has no photograph, and hands the same photograph to every
 * record that shares one. This pass works record by record over exactly what
 * the home page shows, and it holds two rules the class pipeline cannot:
 *
 *   unique     no picture is used twice anywhere on the page. Assignments are
 *              made centrally, against a running set of what is already spoken
 *              for, rather than independently per row.
 *   relevant   a candidate is confirmed against the RECORD'S OWN HEADLINE, not
 *              against a technology label. "Would a science editor run this
 *              beside this headline?" is the question a reader is really
 *              asking, and it is the one worth putting to the model.
 *
 * Candidates come from the reviewed pool first, since those are pictures a
 * person has already looked at, and then from Commons searches built out of
 * the record's own topic tags.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { loadClassImages, commonsSearch, isRejected, confirmSinglePhoto } from './lib/images.js'

const COMMIT = process.argv.includes('--commit')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const HERE = dirname(fileURLToPath(import.meta.url))
const NOTABLE_PATH = join(HERE, '../src/data/notable.json')
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'

/** Does this picture belong beside this headline? Asked of the headline
 *  itself, so the answer is about the story a reader is looking at. */
async function fitsHeadline(url, headline) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return false
    const media = (res.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(jpeg|png|webp)$/.test(media)) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4_500_000) return false
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          { type: 'text', text: `A science news site is about to run this photograph beside the headline below, captioned as an illustration.

"${headline}"

Would a science editor accept it? Reply YES only if ALL of these hold:

1. The photograph shows the technology, instrument or subject the headline is about. A DIFFERENT technology is a no: a vagus nerve stimulator is not a speech implant, an ultrasound probe is not a magnetic device.
2. If the headline describes a person — "a woman", "a patient", someone named — nobody in the photograph contradicts that description. A man under a headline about a woman is a no.
3. Any person shown is either the subject of the story or is anonymously using the technology in question. An unconnected person is a no, because a photograph of a person beside a headline says that this is the person the story is about.

Reply NO if you are unsure. Exactly one word: YES or NO.` },
        ],
      }],
    })
    return (r.content?.[0]?.text || '').toUpperCase().includes('YES')
  } catch { return false }
}

const pool = loadClassImages()
const poolImages = Object.entries(pool).flatMap(([classId, c]) => c.images.map(i => ({ ...i, classId })))

/** Search terms from what the record says it is about. */
function termsFor(row) {
  const topics = (row.topics || []).filter(t => t.length > 2).slice(0, 3)
  return [...new Set(topics.map(t => t.toLowerCase()))]
}

const used = new Set()
const stamp = img => ({
  image: img.url, imageKind: img.kind || 'photo', imageSubject: 'class', imageCredit: img.credit,
  imageLicense: img.license, imageLicenseUrl: img.licenseUrl, imageSource: img.source,
  imageSourceUrl: img.sourceUrl, imageClassId: img.classId || null, imageW: img.w, imageH: img.h,
  imageCheckedAt: new Date().toISOString(),
})
const columns = img => ({
  image_url: img.url, image_kind: img.kind || 'photo', image_subject: 'class', image_credit: img.credit,
  image_license: img.license, image_license_url: img.licenseUrl, image_source: img.source,
  image_source_url: img.sourceUrl, image_w: img.w, image_h: img.h, image_checked_at: new Date().toISOString(),
})

/** The first candidate that is free and that fits this headline. */
async function pick(headline, extraTerms = []) {
  for (const img of poolImages) {
    if (used.has(img.url)) continue
    if (await fitsHeadline(img.url, headline)) return img
  }
  for (const term of extraTerms) {
    for (const cand of await commonsSearch(term, { limit: 8 })) {
      if (used.has(cand.url) || isRejected(cand.title)) continue
      if (!(await confirmSinglePhoto(cand.url))) continue
      if (await fitsHeadline(cand.url, headline)) { const { title, ...img } = cand; return img }
    }
  }
  return null
}

// ── What the home page shows ────────────────────────────────────────────────

const { data: feed } = await sb.from('news_feed').select('id,title,topics,entry_type,metadata')
  .neq('entry_type', 'trial').limit(400)
const stories = (feed || []).sort((a, b) => (b.metadata?.rankScore ?? 0) - (a.metadata?.rankScore ?? 0)).slice(0, 14)

const { data: trials } = await sb.from('news_feed').select('id,title,topics,metadata')
  .eq('entry_type', 'trial').order('relevance_score', { ascending: false }).limit(4)

const { data: devices } = await sb.from('devices').select('id,name,description,image_url,image_subject')
  .order('year', { ascending: false, nullsFirst: false }).limit(4)

const notable = JSON.parse(readFileSync(NOTABLE_PATH, 'utf8'))

// Everything already on the page speaks for its picture first.
for (const r of [...stories, ...(trials || [])]) if (r.metadata?.image) used.add(r.metadata.image)
for (const d of devices || []) if (d.image_url) used.add(d.image_url)
for (const n of notable) if (n.image_url) used.add(n.image_url)

let filled = 0, missed = []

for (const r of [...stories, ...(trials || [])]) {
  if (r.metadata?.image) continue
  const img = await pick(r.title, termsFor(r))
  console.log(`  ${img ? '●' : '·'} ${String(r.title).slice(0, 56).padEnd(58)} ${img ? img.url.split('/').pop().slice(0, 40) : 'nothing fits'}`)
  if (!img) { missed.push(r.title); continue }
  used.add(img.url); filled++
  if (COMMIT) await sb.from('news_feed').update({ metadata: { ...(r.metadata || {}), ...stamp(img) } }).eq('id', r.id)
}

for (const d of devices || []) {
  if (d.image_url) continue
  const img = await pick(d.name, [])
  console.log(`  ${img ? '●' : '·'} [device] ${String(d.name).slice(0, 46).padEnd(48)} ${img ? img.url.split('/').pop().slice(0, 40) : 'nothing fits'}`)
  if (!img) { missed.push(d.name); continue }
  used.add(img.url); filled++
  if (COMMIT) await sb.from('devices').update(columns(img)).eq('id', d.id)
}

let notableChanged = false
for (const n of notable) {
  if (n.image_url) continue
  const img = await pick(n.title, [])
  console.log(`  ${img ? '●' : '·'} [notable] ${String(n.title).slice(0, 45).padEnd(47)} ${img ? img.url.split('/').pop().slice(0, 40) : 'nothing fits'}`)
  if (!img) { missed.push(n.title); continue }
  used.add(img.url); filled++; notableChanged = true
  Object.assign(n, columns(img))
}
if (COMMIT && notableChanged) writeFileSync(NOTABLE_PATH, JSON.stringify(notable, null, 2) + '\n')

console.log(`\n${filled} cards given a picture, ${missed.length} still without one`)
missed.forEach(m => console.log(`  none: ${String(m).slice(0, 70)}`))
if (!COMMIT) console.log('\nDry run. Re-run with --commit to write.')
