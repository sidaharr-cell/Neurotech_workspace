/**
 * audit-home-images.js — judge the pictures the home page actually renders.
 *
 *   node --env-file-if-exists=.env scripts/audit-home-images.js cards.json
 *
 * `cards.json` is what the rendered page reports: an array of
 * { section, headline, src, credit }, scraped from the DOM rather than
 * reconstructed from the database, so what is judged is what a reader sees.
 *
 * Three questions per card, because they fail differently:
 *
 *   fits     does the picture belong beside this headline? A photograph of a
 *            spinal cord stimulator over a story about one is right; the same
 *            photograph over a story about a drug trial is not.
 *   quality  would a scientific publication run it? Marketing collages,
 *            screenshots, watermarked stock and unreadable clutter are out.
 *   crop     does it survive being cropped to a wide card, or does the subject
 *            sit somewhere the crop will cut away?
 *
 * Exits non-zero when any card fails, so this can gate a release.
 */
import { readFileSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'

const cards = JSON.parse(readFileSync(process.argv[2] || 'cards.json', 'utf8'))

async function judge(card) {
  let media, buf
  try {
    const res = await fetch(card.src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { ...card, verdict: 'UNREACHABLE', why: `HTTP ${res.status}` }
    media = (res.headers.get('content-type') || '').split(';')[0]
    buf = Buffer.from(await res.arrayBuffer())
    if (!/^image\/(jpeg|png|gif|webp)$/.test(media)) return { ...card, verdict: 'UNREACHABLE', why: media }
    if (buf.length > 4_500_000) return { ...card, verdict: 'SKIP', why: 'too large to inspect' }
  } catch (e) { return { ...card, verdict: 'UNREACHABLE', why: e.message } }

  const prompt = `This image runs beside a headline on a scientific news site.

Headline: "${card.headline}"
${card.credit ? `Caption shown to the reader: "${card.credit}"` : 'No caption is shown.'}

Answer three questions, one line each, exactly in this form:
FITS: yes|no — <six words>
QUALITY: yes|no — <six words>
CROP: yes|no — <six words>

FITS asks whether a science editor would accept this picture beside this headline. A photograph of the instrument or subject the headline is about is a yes. A picture of a DIFFERENT instrument or an unrelated subject is a no. When the caption calls it an illustration, a picture of the general technology or of the nervous system is acceptable.
QUALITY asks whether a serious publication would print it: no marketing collages, no screenshots of interfaces, no watermarks, no clip art, no cluttered text-heavy pages, no low-grade snapshots.
CROP asks whether the subject stays visible when this is cropped to a wide rectangle from the centre.`

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      }],
    })
    const text = r.content?.[0]?.text || ''
    const get = k => new RegExp(`${k}:\\s*(yes|no)\\s*[—-]?\\s*(.*)`, 'i').exec(text) || []
    const [, fits, fitsWhy] = get('FITS')
    const [, quality, qualityWhy] = get('QUALITY')
    const [, crop, cropWhy] = get('CROP')
    const bad = [
      /^no$/i.test(fits || '') ? `fit: ${fitsWhy}` : null,
      /^no$/i.test(quality || '') ? `quality: ${qualityWhy}` : null,
      /^no$/i.test(crop || '') ? `crop: ${cropWhy}` : null,
    ].filter(Boolean)
    return { ...card, verdict: bad.length ? 'FAIL' : 'PASS', why: bad.join('; ') }
  } catch (e) { return { ...card, verdict: 'ERROR', why: e.message } }
}

const results = []
for (let i = 0; i < cards.length; i += 4) {
  results.push(...await Promise.all(cards.slice(i, i + 4).map(judge)))
}

// Duplicates are a page-level fault, not a card-level one: the same photograph
// twice on one page reads as a template, however good the picture is.
const bySrc = new Map()
for (const c of cards) bySrc.set(c.src, (bySrc.get(c.src) || 0) + 1)
const dupes = [...bySrc.entries()].filter(([, n]) => n > 1)

for (const r of results) {
  const mark = r.verdict === 'PASS' ? '·' : '✗'
  console.log(`${mark} [${r.section}] ${String(r.headline).slice(0, 48).padEnd(50)} ${r.verdict}${r.why ? ` — ${r.why}` : ''}`)
}

const failed = results.filter(r => r.verdict !== 'PASS')
console.log(`\n${results.length} cards checked, ${failed.length} to fix, ${dupes.length} duplicate pictures`)
for (const [src, n] of dupes) console.log(`  ${n}× ${src.slice(0, 90)}`)
process.exit(failed.length || dupes.length ? 1 : 0)
