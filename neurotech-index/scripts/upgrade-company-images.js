/**
 * upgrade-company-images.js — find a genuinely large picture for a company.
 *
 *   node scripts/upgrade-company-images.js            # dry run
 *   node scripts/upgrade-company-images.js --commit   # writes scratch/enrich/images.json
 *   node scripts/upgrade-company-images.js --limit 50 # try only the first N
 *
 * THE PROBLEM
 *
 * 54 of the 61 company images are under 400px wide, and most are exactly
 * 180x180. Their URLs say what they are: apple-touch-icon.png, favicon.png,
 * webclip.png. `siteIcon` in scripts/lib/images.js fetches them on purpose and
 * its comment is explicit — "Small by nature, so it is a mark, not a photo."
 *
 * Nothing was wrong with that until the company page began rendering the mark
 * in a 16:9 frame the full width of the measure, which upscales a 180px icon
 * about four times and shows it soft.
 *
 * THE FIX HERE
 *
 * A site's og:image is the picture it publishes for social cards. It is
 * conventionally around 1200x630, which is a real picture at hero size rather
 * than an icon. This asks each company's own site for one and keeps it only if
 * it clears HI_RES, the bar this project already uses for its lead slot.
 *
 * A favicon by another name is still a favicon, so anything whose URL looks
 * like an icon is rejected however large it measures.
 *
 * Nothing is written to Supabase. The result lands in the research overlay,
 * beside the database, for the same reason everything else in this pass does.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { measureImage, HI_RES, SANE_ASPECT } from './lib/images.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const COMPANIES = resolve(__dir, '../scratch/enrich/companies.json')
const TARGET = resolve(__dir, '../scratch/enrich/images.json')
const COMMIT = process.argv.includes('--commit')
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity
const CONCURRENCY = 8

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// A picture named like an icon is an icon. Sites frequently point og:image at
// their touch icon, which measures small and would be rejected anyway, but some
// serve a padded 1200x1200 version of the same mark and that is still a mark.
const ICONISH = /favicon|apple-touch|webclip|touch-icon|android-chrome|mstile|logo[-_.]?(sm|small|icon)|sprite/i

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function pageHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    if (!/text\/html/i.test(type)) return null
    return (await res.text()).slice(0, 400_000)
  } catch { return null }
}

/** og:image, then twitter:image. Both are pictures a site chose to represent itself. */
function socialImage(html, base) {
  if (!html) return null
  const pats = [
    /<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  ]
  for (const re of pats) {
    const raw = html.match(re)?.[1]
    if (!raw) continue
    try { return new URL(raw, base).href } catch { /* keep looking */ }
  }
  return null
}

const companies = JSON.parse(readFileSync(COMPANIES, 'utf8'))
  .filter(c => c.website)
  .slice(0, LIMIT)

const found = existsSync(TARGET) ? JSON.parse(readFileSync(TARGET, 'utf8')) : {}
let checked = 0, upgraded = 0, tooSmall = 0, iconish = 0, noneFound = 0, badShape = 0

async function one(c) {
  checked++
  const html = await pageHtml(c.website)
  if (!html) { noneFound++; return }
  const url = socialImage(html, c.website)
  if (!url) { noneFound++; return }
  if (ICONISH.test(url)) { iconish++; return }
  const dim = await measureImage(url)
  if (!dim) { noneFound++; return }
  if (!HI_RES(dim)) { tooSmall++; return }
  // A 35203x2922 wordmark lockup passes any resolution bar and is still a
  // banner strip: in a 16:9 frame it arrives as a sliver. SANE_ASPECT is this
  // project's existing 3:1 limit, and it is what separates a picture from a
  // logo file that happens to be enormous.
  if (!SANE_ASPECT(dim)) { badShape++; return }
  upgraded++
  found[c.id] = {
    name: c.name,
    url,
    w: dim.width,
    h: dim.height,
    // The site published this picture of itself, so it is the record's own and
    // needs no "Illustration" label. Credit is the host, as siteIcon does.
    kind: 'photo',
    subject: 'item',
    source: 'site-og',
    sourceUrl: c.website,
    credit: (() => { try { return new URL(c.website).hostname.replace(/^www\./, '') } catch { return null } })(),
  }
}

// A small pool, paced. These are other people's servers and this is 1,081 of them.
const queue = [...companies]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const c = queue.shift()
    await one(c)
    if (checked % 50 === 0) process.stdout.write(`  ${checked}/${companies.length} checked, ${upgraded} upgraded\n`)
    await sleep(120)
  }
}))

console.log(`\nchecked        ${checked}`)
console.log(`upgraded       ${upgraded}  (og:image clearing HI_RES)`)
console.log(`too small      ${tooSmall}`)
console.log(`icon by name   ${iconish}`)
console.log(`bad shape      ${badShape}  (beyond 3:1, a banner or a strip)`)
console.log(`no image found ${noneFound}`)

if (COMMIT) {
  writeFileSync(TARGET, JSON.stringify(found, null, 1) + '\n')
  console.log(`\nWROTE -> ${TARGET} (${Object.keys(found).length} companies)`)
} else {
  console.log('\nDry run. Re-run with --commit to write.')
}
