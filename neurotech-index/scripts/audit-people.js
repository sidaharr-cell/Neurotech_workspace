/**
 * audit-people.js — who is in the picture, and do they belong there?
 *
 *   node --env-file-if-exists=.env scripts/audit-people.js cards.json
 *
 * A photograph of a person makes a claim a photograph of hardware does not.
 * Run beside a headline, it says: this is the person the story is about. So a
 * person may only appear when one of these is true:
 *
 *   · the picture is the record's own — the outlet's photograph of its own
 *     story, a maker's photograph of its own product, a company's own mark
 *   · the person IS the subject: Neuralink's first patient over a story about
 *     Neuralink's patients
 *   · the person is anonymous and USING the technology the record is about: a
 *     patient under a TMS coil over a trial of TMS
 *
 * A conference attendee wearing an EEG cap over a company's commercialisation
 * announcement is none of these. Neither is a man over a story about a woman.
 *
 * The second check is agreement: when a headline says "a woman", or names
 * somebody, the picture has to match. Getting that wrong is not a near miss,
 * it is a different person.
 */
import { readFileSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'
const cards = JSON.parse(readFileSync(process.argv[2] || 'cards.json', 'utf8'))

async function look(card) {
  let media, buf
  try {
    const res = await fetch(card.src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { ...card, verdict: 'UNREACHABLE' }
    media = (res.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(jpeg|png|webp|gif)$/.test(media)) return { ...card, verdict: 'SKIP' }
    buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4_500_000) return { ...card, verdict: 'SKIP' }
  } catch { return { ...card, verdict: 'UNREACHABLE' } }

  const prompt = `This photograph runs beside a headline on a science news site.

Headline: "${card.headline}"
Source shown to the reader: "${card.credit || 'none'}"

Answer three lines, exactly:
PEOPLE: none|anonymous|identifiable — <what they appear to be doing, six words>
AGREES: yes|no|n/a — <six words>
VERDICT: keep|replace — <six words>

PEOPLE is "none" if no person is visible; "anonymous" if people appear but are incidental or shown using equipment, faces not the point; "identifiable" if a particular person is the subject of the photograph.

AGREES asks whether the people shown match what the headline says. If the headline says "a woman", a man is no. If the headline names a person, someone else is no. If the headline mentions no person, answer n/a.

VERDICT is "replace" if a reader would be misled about who they are looking at: a person who is not the subject and is not simply using the technology in question, or people who contradict the headline. Otherwise "keep".`

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      }],
    })
    const text = r.content?.[0]?.text || ''
    const field = k => (new RegExp(`${k}:\\s*([a-z/]+)\\s*[—-]?\\s*(.*)`, 'i').exec(text) || []).slice(1)
    const [people, peopleWhy] = field('PEOPLE')
    const [agrees, agreesWhy] = field('AGREES')
    const [verdict, verdictWhy] = field('VERDICT')
    return { ...card, people, peopleWhy, agrees, agreesWhy, verdict: (verdict || '').toLowerCase(), verdictWhy }
  } catch (e) { return { ...card, verdict: 'ERROR', verdictWhy: e.message } }
}

const results = []
for (let i = 0; i < cards.length; i += 4) {
  results.push(...await Promise.all(cards.slice(i, i + 4).map(look)))
}

for (const r of results) {
  const bad = r.verdict === 'replace' || /^no$/i.test(r.agrees || '')
  console.log(`${bad ? '✗' : '·'} [${r.section}] ${String(r.headline).slice(0, 46).padEnd(48)} people:${(r.people || '?').padEnd(12)} agrees:${(r.agrees || '?').padEnd(4)} ${bad ? `— ${r.verdictWhy || r.agreesWhy}` : ''}`)
}
const bad = results.filter(r => r.verdict === 'replace' || /^no$/i.test(r.agrees || ''))
console.log(`\n${results.length} checked, ${bad.length} to replace`)
bad.forEach(b => console.log(`  ${String(b.headline).slice(0, 60)}\n    ${b.peopleWhy || ''} | ${b.verdictWhy || b.agreesWhy || ''}`))
process.exit(bad.length ? 1 : 0)
