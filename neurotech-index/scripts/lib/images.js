/**
 * images.js — sourcing a real picture for a record, with its provenance.
 *
 * Every image this module returns arrives as a full block:
 *
 *   { url, kind, subject, credit, license, licenseUrl, source, sourceUrl, w, h }
 *
 * `subject` is the load-bearing field.
 *
 *   'item'   the picture IS the record: a figure out of this paper, this
 *            company's own logo, the photograph an outlet ran with this story.
 *   'class'  the picture is a licensed photograph of the TECHNOLOGY, not of
 *            this exact device or trial. No photograph of an individual 510(k)
 *            submission or an individual trial exists in any open source, so a
 *            spinal cord stimulator clearance borrows a real, credited
 *            photograph of a spinal cord stimulator. The UI labels these
 *            "Illustration" and prints the credit. Unlabelled, the picture
 *            would assert something the record cannot support.
 *
 * Nothing is copied onto our own storage. `url` points at the source, and
 * verifyImage re-checks it so a dead link is cleared rather than left rotting
 * on the page.
 *
 * What is reachable, measured 1 August 2026:
 *   · Europe PMC figures  work, through the fulltextRepo endpoint. The
 *     /pmc/articles/<id>/bin/<file> path this code used before now 404s, which
 *     is why the feed carried no paper figures at all.
 *   · bioRxiv / medRxiv   work, through the article page's F1.large.jpg.
 *   · Publisher pages     403 to any script (Wiley, Science) or answer with a
 *     login redirect (Nature). There is no figure to be had for a recent
 *     paywalled paper until it reaches PMC.
 *   · Wikimedia Commons   works, and carries the licence and the author.
 *   · Wikidata P154       carries company logos, for the known names only.
 *   · openFDA             names the technology behind a product code, which is
 *     the only place a 510(k) record says what the device actually is.
 *
 * A search engine is not a picture editor: Commons answers "microelectrode
 * array" with a file called Mea Culpa.JPG and "vagus nerve" with a page of a
 * physiology textbook from 1897. Every class candidate is therefore confirmed
 * by a vision model before it is accepted, and a class with no confirmable
 * photograph yields nothing.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const UA = 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

let anthropic = null
const claude = () => (anthropic ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

const getJson = async (url, ua = UA) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}
const getText = async (url, ua = UA) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow', signal: AbortSignal.timeout(15000) })
    return r.ok ? await r.text() : null
  } catch { return null }
}

// ── Measuring and checking ──────────────────────────────────────────────────

/** Pixel dimensions from an image buffer's header (JPEG/PNG/GIF/WebP). */
export function getImageSize(buf) {
  if (!buf || buf.length < 24) return null
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16)
    if (fourcc === 'VP8X') return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) }
    if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (fourcc === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) } }
    return null
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let o = 2
    while (o < buf.length - 8) {
      if (buf[o] !== 0xFF) { o++; continue }
      const marker = buf[o + 1]
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) }
      }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  return null
}

/** Fetch an image and return its dimensions, or null. */
export async function measureImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    const dim = getImageSize(Buffer.from(await res.arrayBuffer()))
    return dim && dim.width && dim.height ? dim : null
  } catch { return null }
}

/** The bar for the lead slot, which is displayed 1100px wide. */
export const HI_RES = d => !!d && Math.max(d.width, d.height) >= 900 && Math.min(d.width, d.height) >= 500

/**
 * A shape a card can crop without destroying it.
 *
 * Cards are 4:3 and fill by cropping, so a 916x123 banner strip arrives as a
 * sliver of itself and a very tall portrait loses its subject. Three to one in
 * either direction is as far as that survives.
 */
export const SANE_ASPECT = d => {
  if (!d || !d.width || !d.height) return false
  const r = d.width / d.height
  return r <= 3 && r >= 1 / 3
}

/** The bar for a card. Journal figures are often modest; 450px still reads
 *  cleanly in a 4:3 card and refusing them would throw away most of PMC. */
export const CARD_RES = d => !!d && Math.max(d.width, d.height) >= 450 && SANE_ASPECT(d)

/**
 * Is this URL still an image? Used by the rot check. Returns
 * { ok, status, dims } so a caller can tell "gone" from "unreachable today".
 */
export async function verifyImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return { ok: false, status: res.status, dims: null }
    const ct = res.headers.get('content-type') || ''
    if (!ct.startsWith('image/')) return { ok: false, status: res.status, dims: null }
    if (ct.includes('svg')) return { ok: true, status: res.status, dims: null }  // vector: no raster header
    return { ok: true, status: res.status, dims: getImageSize(Buffer.from(await res.arrayBuffer())) }
  } catch (e) { return { ok: false, status: `ERR ${e.message}`, dims: null } }
}

// ── Vision checks ───────────────────────────────────────────────────────────

/** Anthropic's fetcher cannot download from every host — Wikimedia refuses it —
 *  so the bytes are fetched here and sent inline. Oversized files are skipped
 *  rather than sent: the callers all have a thumbnail to offer instead. */
const MAX_INLINE = 4_500_000
const ask = async (url, text, maxTokens = 5) => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const mediaType = (res.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mediaType)) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_INLINE) return ''
    const r = await claude().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
          { type: 'text', text },
        ],
      }],
    })
    return (r.content?.[0]?.text || '').toUpperCase()
  } catch { return '' }
}

/** Photograph, scan or figure of real subject matter, vs stock decoration. */
export async function classifyImageUrl(url) {
  const a = await ask(url, 'Reply REAL if this image is a photograph, microscopy image, medical/brain scan, or an anatomical or technical diagram of actual subject matter. Reply STOCK if it is a data chart, graph, plot, or table; a generic stock illustration or 3D render; a publisher logo; or decorative art. Exactly one word: REAL or STOCK.')
  return a.includes('REAL') ? 'real' : a.includes('STOCK') ? 'stock' : null
}

/**
 * Does this picture actually show the technology we are about to label it
 * with? The gate that keeps a scanned 1897 physiology textbook off a vagus
 * nerve stimulator card, and a patent line drawing off a microelectrode array.
 * Defaults to NO on any doubt or any error.
 *
 * Photographs and radiographs only. A diagram is not wrong, exactly, but a
 * card that already carries a data figure gains nothing from a second one, and
 * an explanatory diagram of a mechanism is a claim about how something works
 * rather than a picture of it.
 */
/**
 * Is this a photograph at all?
 *
 * Wikipedia leads a drug article with its skeletal formula and a protein
 * article with a ribbon rendering. Both are the right picture for Wikipedia
 * and the wrong picture for a card: a card that already carries a data figure
 * gains nothing from a second diagram. Defaults to NO on any error.
 */
export async function confirmPhotograph(url) {
  const a = await ask(url, 'Is this a PHOTOGRAPH of a real object, person, or place, or a medical scan such as an X-ray or MRI? Reply NO if it is a chemical structure, molecular diagram, schematic, chart, graph, map, logo, line drawing, rendering, or screenshot. Exactly one word: YES or NO.')
  return a.includes('YES')
}

/**
 * Is the DEVICE the subject of this photograph?
 *
 * A maker's site is mostly lifestyle photography: Cala Health's home page
 * leads with a man holding a mug and a tablet, wearing the wristband
 * somewhere out of focus. A reader learns nothing about the device from it.
 * This gate asks for the hardware, not the mood.
 */
export async function confirmProductPhoto(url) {
  const a = await ask(url, 'Is a medical device, wearable, implant, or piece of hardware the MAIN SUBJECT of this photograph — the device by itself, or worn, held or attached so that the device itself is clearly visible and in focus? Reply NO if it is a lifestyle or marketing photograph where the device is incidental, out of focus, or absent; a portrait or group of people; an office, home or laboratory scene; a logo; or a diagram. Exactly one word: YES or NO.')
  return a.includes('YES')
}

/**
 * Two structural questions a class photograph has to pass, asked separately
 * because a combined prompt lets them blur.
 *
 * SINGLE catches the figures Commons is full of: four panels lettered A to D,
 * scale bars, arrows and callouts. One of those on a card is an unreadable
 * fragment of itself.
 *
 * SAFE catches what a general news page should not run without warning:
 * exposed tissue, surgery in progress, cadavers. Both were slipping past the
 * depiction check, which asks only whether the subject is right.
 */
/**
 * One image, or a grid of panels?
 *
 * Asked of a paper's own figure, where the subject is right by definition and
 * the only question is whether a reader can make anything of it 300 pixels
 * wide. Figure 1 is usually a composite of lettered panels, microscopy grids
 * and plots; at card size that is grey noise.
 */
export async function confirmSinglePanel(url) {
  const a = await ask(url, 'Is this ONE single image, rather than a composite of several panels? Reply NO if it is divided into multiple panels or sub-figures, has panels lettered a, b, c or A, B, C, or combines photographs with plots or charts. Reply YES only for a single uninterrupted image. Exactly one word: YES or NO.')
  return a.includes('YES')
}

export async function confirmSinglePhoto(url) {
  const a = await ask(url, `Answer both questions about this image, one per line, exactly:
SINGLE: yes|no
SAFE: yes|no

SINGLE is yes only if this is ONE photograph. It is no if the image combines several panels or views, has panels lettered A, B, C, has arrows, callouts, scale bars or text labels drawn onto it, or contains an embedded chart.
SAFE is yes if a general news site could run it beside a headline without warning the reader. It is no for exposed tissue or organs, surgery in progress, open wounds, blood, cadavers or dissection.`, 20)
  return /SINGLE:\s*yes/i.test(a) && /SAFE:\s*yes/i.test(a)
}

export async function confirmDepicts(url, label) {
  const a = await ask(url, `Is this a PHOTOGRAPH (or a medical scan such as an X-ray or MRI) showing ${label}? Reply YES only if a reader would recognise the actual hardware, or a person wearing or implanted with it. Reply NO if it is a diagram, illustration, schematic, patent drawing, chart, book or document scan, logo, screenshot, or shows something else. Reply NO if it is a FIGURE FROM A PAPER: several panels combined, panels lettered a/b/c, arrows or callouts drawn on, embedded plots, or captions burned into the image. Exactly one word: YES or NO.`)
  return a.includes('YES')
}

// ── Open Graph (news, and any page that will answer us) ─────────────────────

/** Best-effort Open Graph image for a page. Fails soft. */
export async function ogImage(pageUrl) {
  const html = await getText(pageUrl, BROWSER_UA)
  if (!html) return null
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
  if (!m?.[1]) return null
  try { return new URL(m[1], pageUrl).href } catch { return null }
}

// ── Licences ────────────────────────────────────────────────────────────────

/** The licences that let us show someone else's figure. Anything else is left
 *  alone: an unlicensed figure is not ours to publish. */
const REUSABLE = /^(cc[\s_-]?(by|0|zero)|public domain|pd\b|no known copyright)/i
export const isReusableLicense = l => Boolean(l) && REUSABLE.test(String(l).trim())

// ── Europe PMC: figures out of the open-access article itself ───────────────

/** First figure graphic named in a JATS full text, or null. Pure. */
export function firstFigureHref(xml) {
  if (!xml) return null
  const fig = xml.match(/<fig[\s>][\s\S]*?<\/fig>/i)?.[0]
  const href = (fig || xml).match(/<graphic[^>]*xlink:href="([^"]+)"/i)?.[1]
  if (!href) return null
  return /\.(jpe?g|png|gif|webp)$/i.test(href) ? href : `${href}.jpg`
}

/** The endpoint that serves a PMC figure file today. Pure. */
export const europePmcFileUrl = (pmcid, fileName) =>
  `https://europepmc.org/api/fulltextRepo?pprId=${encodeURIComponent(pmcid)}` +
  `&type=FILE&fileName=${encodeURIComponent(fileName)}&mimeType=image/jpeg`

/** The credit line for a figure: whose figure it is. Pure. */
export function articleCredit(rec = {}) {
  const author = rec.authorString ? String(rec.authorString).split(',')[0].trim() : null
  return [author ? `${author} et al.` : null, rec.journalTitle, rec.pubYear].filter(Boolean).join(', ') || null
}

/** A figure from the paper itself, for an open-access paper in PMC. */
export async function europePmcFigure({ doi, pmid } = {}) {
  const query = doi ? `DOI:"${doi}"` : pmid ? `EXT_ID:${pmid} AND SRC:MED` : null
  if (!query) return null
  const search = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=1`)
  const rec = search?.resultList?.result?.[0]
  if (!rec?.pmcid) return null
  if (rec.isOpenAccess !== 'Y' && rec.inEPMC !== 'Y') return null
  if (!isReusableLicense(rec.license)) return null

  const file = firstFigureHref(await getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${rec.pmcid}/fullTextXML`))
  if (!file) return null
  const url = europePmcFileUrl(rec.pmcid, file)
  const dims = await measureImage(url)
  if (!CARD_RES(dims)) return null
  // Figure 1 of a paper is usually a composite of eight labelled panels. It is
  // the most authentic picture a paper has and an unreadable one at card size,
  // so only a figure that is a single image is kept.
  if (!(await confirmSinglePanel(url))) return null

  return {
    url,
    kind: 'figure',
    subject: 'item',
    credit: articleCredit(rec),
    license: rec.license,
    licenseUrl: null,
    source: 'europepmc',
    sourceUrl: `https://europepmc.org/article/PMC/${rec.pmcid}`,
    w: dims.width,
    h: dims.height,
  }
}

// ── bioRxiv / medRxiv: the preprint's own first figure ──────────────────────

/** The first figure image URL on a bioRxiv/medRxiv article page. Pure. */
export function preprintFigureHref(html) {
  const m = String(html || '').match(/https?:\/\/[^"']*\/F\d+\.(?:large|medium)\.jpg[^"'?]*/i)
  return m ? m[0] : null
}

/** Which preprint server a record belongs to, from its DOI or URL. Pure. */
export function preprintServer({ url, doi } = {}) {
  const host = (() => { try { return url ? new URL(url).hostname : '' } catch { return '' } })()
  if (/medrxiv\.org$/i.test(host)) return 'medrxiv'
  if (/biorxiv\.org$/i.test(host)) return 'biorxiv'
  return String(doi || '').startsWith('10.1101/') ? 'biorxiv' : null
}

/** A preprint's own first figure. bioRxiv states the licence in its API. */
export async function preprintFigure({ url, doi } = {}) {
  const server = preprintServer({ url, doi })
  if (!server) return null
  const cleanDoi = String(doi || '').replace(/^https?:\/\/doi\.org\//, '')
  if (!cleanDoi) return null

  const api = await getJson(`https://api.biorxiv.org/details/${server}/${cleanDoi}`)
  const detail = api?.collection?.[api.collection.length - 1]
  const license = detail?.license ? detail.license.replace(/_/g, ' ') : null
  if (!isReusableLicense(license)) return null

  const page = `https://www.${server}.org/content/${cleanDoi}v${detail.version || 1}.full`
  const fig = preprintFigureHref(await getText(page, BROWSER_UA))
  if (!fig) return null
  const dims = await measureImage(fig)
  if (!CARD_RES(dims)) return null
  if (!(await confirmSinglePanel(fig))) return null

  return {
    url: fig,
    kind: 'figure',
    subject: 'item',
    credit: [detail.authors ? `${String(detail.authors).split(';')[0].trim()} et al.` : null,
      server === 'medrxiv' ? 'medRxiv' : 'bioRxiv'].filter(Boolean).join(', '),
    license,
    licenseUrl: null,
    source: server,
    sourceUrl: page,
    w: dims.width,
    h: dims.height,
  }
}

// ── Wikimedia Commons ───────────────────────────────────────────────────────

const stripHtml = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/**
 * A Commons API response as image blocks. Pure, so it is testable without the
 * network. A file with no licence or no author is dropped: every licence
 * Commons carries requires attribution, and a picture we cannot attribute is a
 * picture we cannot publish.
 */
export function parseCommons(json, { subject = 'class', minWidth = 500 } = {}) {
  return Object.values(json?.query?.pages || {})
    .map(p => {
      const info = p.imageinfo?.[0]
      // GIF is excluded: Commons uses it for animations, and a card must not move.
      if (!info?.url || !/^image\/(jpeg|png|webp)$/.test(info.mime || '')) return null
      if ((info.width || 0) < minWidth) return null
      if (!SANE_ASPECT({ width: info.width, height: info.height })) return null
      const meta = info.extmetadata || {}
      const license = stripHtml(meta.LicenseShortName?.value)
      const credit = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value)
      if (!license || !credit) return null
      // The thumbnail, when the API rendered one. An 8000px original on a card
      // is 20MB of page weight for a 400px slot, and Wikimedia publishes the
      // thumbnail service precisely so nobody hotlinks the original.
      const useThumb = info.thumburl && info.thumbwidth >= minWidth
      return {
        url: useThumb ? info.thumburl : info.url,
        kind: 'photo',
        subject,
        credit: credit.slice(0, 120),
        license,
        licenseUrl: meta.LicenseUrl?.value || null,
        source: 'commons',
        sourceUrl: info.descriptionurl || null,
        w: useThumb ? info.thumbwidth : info.width,
        h: useThumb ? info.thumbheight : info.height,
        title: p.title,
      }
    })
    .filter(Boolean)
}

const COMMONS_PROPS = 'prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1280'

/** Search Commons for photographs matching a term. */
export async function commonsSearch(term, { limit = 8, subject = 'class', minWidth = 500 } = {}) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + `&generator=search&gsrsearch=${encodeURIComponent(`${term} filetype:bitmap`)}`
    + `&gsrnamespace=6&gsrlimit=${limit}&${COMMONS_PROPS}`
  return parseCommons(await getJson(url), { subject, minWidth })
}

/**
 * The files in a Commons category.
 *
 * A category is curated by people who know the subject, so it holds pictures a
 * text search never surfaces: "Category:Transcranial magnetic stimulation"
 * carries photographs of machines and sessions, while searching the same words
 * returns the schematic that leads the Wikipedia article.
 */
export async function commonsCategory(category, { limit = 24, subject = 'class', minWidth = 500 } = {}) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + `&generator=categorymembers&gcmtitle=${encodeURIComponent(`Category:${category}`)}`
    + `&gcmtype=file&gcmlimit=${limit}&${COMMONS_PROPS}`
  return parseCommons(await getJson(url), { subject, minWidth })
}

/**
 * Every image used on a Wikipedia article, not just the one that leads it.
 * The lead image of "Transcranial magnetic stimulation" is a schematic; the
 * photographs are further down the page.
 */
export async function wikipediaArticleImages(title, { limit = 20, subject = 'class', minWidth = 500 } = {}) {
  const json = await getJson('https://en.wikipedia.org/w/api.php?action=query&format=json'
    + `&titles=${encodeURIComponent(title)}&generator=images&gimlimit=${limit}&${COMMONS_PROPS}`)
  return parseCommons(json, { subject, minWidth })
}

/** One named Commons file (used for Wikidata logo claims). */
export async function commonsFile(fileName, { subject = 'item', minWidth = 0 } = {}) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + `&titles=File:${encodeURIComponent(fileName)}&${COMMONS_PROPS}`
  return parseCommons(await getJson(url), { subject, minWidth })[0] || null
}

// ── Wikipedia: the article about this exact thing ───────────────────────────

/** Loose equality for entity names: case, punctuation and a trailing
 *  disambiguator ("NeuroPace (company)") do not count. Pure. */
export const sameName = (a, b) => {
  const norm = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

/**
 * The lead image of the Wikipedia article about this exact device or company.
 *
 * The article title has to BE the name. Wikipedia will happily answer
 * "Nerivio" with an article about migraine, and a picture of a migraine is not
 * a picture of the device. Pure name matching is what keeps this honest.
 */
export async function wikipediaImage(name, { subject = 'item', minWidth = 400 } = {}) {
  if (!name || name.length < 3) return null
  // pilimit is 1 by default, so a three-result search returns the lead image
  // for one arbitrary page — usually not the page whose title we are matching.
  const search = await getJson('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*'
    + `&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=3&prop=pageimages&piprop=original&pilimit=max`)
  const page = Object.values(search?.query?.pages || {}).find(p => sameName(p.title, name))
  const source = page?.original?.source
  if (!source) return null

  // The file lives on Commons, where the licence and the author live too.
  const file = decodeURIComponent(source.split('/').pop())
  const img = await commonsFile(file, { subject, minWidth })
  if (!img) return null
  if (!(await confirmPhotograph(img.url))) return null
  return { ...img, source: 'wikipedia', sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}` }
}

// ── A maker's own site: the product page for this product ───────────────────

/** The product a device record is named for, without its model numbers and
 *  its second listed variant. Pure. */
export function productName(device = {}) {
  return String(device.name || '')
    .split(/[;,]/)[0]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b[A-Z]{1,3}[-\s]?\d{2,}[A-Z\d-]*\b/g, ' ')   // model numbers: AE03-50, TB-2343F
    .replace(/[®™]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP = new Set(['the', 'a', 'an', 'and', 'for', 'with', 'system', 'device', 'inc', 'llc', 'ltd', 'corp'])
const tokens = s => String(s || '').toLowerCase().match(/[a-z0-9]+/g)?.filter(t => t.length > 2 && !STOP.has(t)) || []

/** How well a link answers to a product name: the share of the name's own
 *  words that the link's text and href carry. Pure. */
export function linkScore(href, text, name) {
  const want = tokens(name)
  if (!want.length) return 0
  const have = new Set([...tokens(text), ...tokens(href)])
  return want.filter(t => have.has(t)).length / want.length
}

/** Absolute links on a page, as { href, text, internal }. Pure. */
export function pageLinks(html, origin) {
  const out = []
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let href
    try { href = new URL(m[1], origin).href } catch { continue }
    if (!/^https?:/.test(href)) continue
    out.push({ href, text: stripHtml(m[2]), internal: href.startsWith(origin) })
  }
  return out
}

/** Does this link's HOST carry the product's own name? A maker often gives a
 *  product a site of its own — Theranica's home page links to nerivio.com —
 *  and that site is still the maker's. Pure. */
export function hostNamesProduct(href, name) {
  let host
  try { host = new URL(href).hostname.toLowerCase() } catch { return false }
  return tokens(name).some(t => t.length > 3 && host.includes(t))
}

/** The largest plausible content image on a page. Pure. */
export function contentImage(html, pageUrl) {
  const og = String(html || '').match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
  const candidates = [og, ...[...String(html || '').matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1])]
  for (const raw of candidates) {
    if (!raw) continue
    if (/logo|icon|sprite|avatar|badge|placeholder|\.svg($|\?)/i.test(raw)) continue
    try { return new URL(raw, pageUrl).href } catch { /* keep looking */ }
  }
  return null
}

/**
 * The picture of a product on the site of the company that makes it.
 *
 * This is the best picture a device record can have: it is that product,
 * photographed by the people who build it. The page has to answer to the
 * product's own name — more than half of the name's words in the link — and
 * the picture has to survive a vision check, so a careers page banner or a
 * stock photograph of a boardroom cannot slip through.
 */
export async function siteProductImage(website, name) {
  if (!website || !name) return null
  let origin
  try { origin = new URL(website).origin } catch { return null }

  const home = await getText(website, BROWSER_UA)
  if (!home) return null
  // Off-site links count only when the host itself is named for the product,
  // so a maker's link to its own product site is followed and its link to a
  // press article is not.
  const scored = pageLinks(home, origin)
    .filter(l => l.internal || hostNamesProduct(l.href, name))
    .map(l => ({ ...l, score: linkScore(l.href, l.text, name) }))
    .filter(l => l.score >= 0.6)
    .sort((a, b) => b.score - a.score)

  // The product's own page first. Then the maker's home page, which shows the
  // hardware they lead with: that is a photograph of their technology but not
  // necessarily of THIS clearance, so it is marked as an illustration and the
  // page labels it.
  const candidates = [
    ...scored.slice(0, 3).map(l => ({ href: l.href, subject: 'item' })),
    { href: website, subject: 'class', html: home },
  ]

  const seen = new Set()
  for (const link of candidates) {
    if (seen.has(link.href)) continue
    seen.add(link.href)
    const page = link.html || await getText(link.href, BROWSER_UA)
    const src = contentImage(page, link.href)
    if (!src) continue
    const dims = await measureImage(src)
    if (!CARD_RES(dims)) continue
    if (!(await confirmProductPhoto(src))) continue
    return {
      url: src,
      kind: 'photo',
      subject: link.subject,
      credit: new URL(link.href).hostname.replace(/^www\./, ''),
      license: null,
      licenseUrl: null,
      source: 'manufacturer',
      sourceUrl: link.href,
      w: dims.width,
      h: dims.height,
    }
  }
  return null
}

/**
 * The maker's own site, worked out from its name and then verified.
 *
 * openFDA gives a manufacturer's name and no URL, and most of these makers are
 * too small to be in the organizations table. The domain is usually the name
 * with the corporate suffix removed, so it is worth trying — but only if the
 * site then says it is that company. The page has to name the maker in its
 * title, its og:site_name, or its copyright line; otherwise a squatted domain
 * would happily supply a photograph of something else entirely.
 */
export async function guessMakerSite(maker) {
  const bare = String(maker || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|plc|corp|corporation|co|gmbh|s\.?r\.?l|sa|nv|bv|ag|oy|ab|limited|company|holdings|group|medical|technologies|technology)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').trim()
  if (bare.length < 4) return null
  // "MagVenture A/S" is magventure.com, "Cala Health, Inc." is calahealth.com:
  // the whole name, the first two words, and the distinctive first word are
  // the three shapes worth trying.
  const words = bare.split(/\s+/).filter(w => w.length > 1)
  if (!words.length) return null
  const slugs = [...new Set([words.join(''), words.slice(0, 2).join(''), words[0]])]
    .filter(x => x.length >= 5 && x.length <= 30)
  const hosts = slugs.flatMap(x => [`https://www.${x}.com`, `https://${x}.com`])

  for (const host of hosts) {
    const html = await getText(host, BROWSER_UA)
    if (!html) continue
    const said = [
      html.match(/<title[^>]*>([\s\S]{0,160}?)<\/title>/i)?.[1],
      html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1],
      html.match(/(?:©|&copy;|copyright)[^<]{0,80}/i)?.[0],
    ].filter(Boolean).join(' ').toLowerCase()
    // The distinctive first word has to appear in what the site calls itself.
    // A domain that never names the maker is somebody else's domain.
    if (said.includes(words[0])) return host
  }
  return null
}

// ── arXiv: the preprint's own first figure ──────────────────────────────────

/** The first figure on an arXiv HTML rendering. Pure. */
export function arxivFigureHref(html, pageUrl) {
  const m = String(html || '').match(/<img\b[^>]*src=["']([^"']+\.(?:png|jpe?g))["']/i)
  if (!m) return null
  try { return new URL(m[1], pageUrl).href } catch { return null }
}

/**
 * A figure from an arXiv preprint, through the HTML rendering arXiv now
 * publishes. arXiv preprints carry an author licence that permits display, and
 * the credit names the paper.
 */
export async function arxivFigure(arxivId) {
  const id = String(arxivId || '').replace(/v\d+$/, '')
  if (!id) return null
  const page = `https://arxiv.org/html/${id}v1`
  const fig = arxivFigureHref(await getText(page, BROWSER_UA), page)
  if (!fig) return null
  const dims = await measureImage(fig)
  if (!CARD_RES(dims)) return null
  if (!(await confirmSinglePanel(fig))) return null
  return {
    url: fig,
    kind: 'figure',
    subject: 'item',
    credit: `arXiv:${id}`,
    license: null,
    licenseUrl: null,
    source: 'arxiv',
    sourceUrl: `https://arxiv.org/abs/${id}`,
    w: dims.width,
    h: dims.height,
  }
}

// ── Wikidata: a company's own logo ──────────────────────────────────────────

/**
 * The entity that is plausibly this COMPANY, not a same-named other thing.
 * Wikidata's top hit for "Synchron" is a form of synchronised swimming, which
 * is exactly the kind of match that puts a wrong picture on a page. Pure.
 */
export function pickCompanyEntity(search, name) {
  const wanted = String(name || '').trim().toLowerCase()
  return (search?.search || []).find(e => {
    const d = String(e.description || '').toLowerCase()
    const isCompany = /company|corporation|business|manufacturer|enterprise|\bfirm\b|startup/.test(d)
    return isCompany && String(e.label || '').trim().toLowerCase() === wanted
  }) || null
}

/** A company's logo, from its Wikidata entity (P154). */
export async function wikidataLogo(name) {
  if (!name) return null
  const search = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=5&search=${encodeURIComponent(name)}`)
  const entity = pickCompanyEntity(search, name)
  if (!entity) return null
  const claims = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&property=P154&entity=${entity.id}`)
  const file = claims?.claims?.P154?.[0]?.mainsnak?.datavalue?.value
  if (!file) return null
  const img = await commonsFile(file, { subject: 'item' })
  return img ? { ...img, kind: 'logo', source: 'wikidata', sourceUrl: `https://www.wikidata.org/wiki/${entity.id}` } : null
}

/** The icon URL a page declares, largest first. Pure. */
export function iconHref(html) {
  const links = [...String(html || '').matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
  const rated = links.map(tag => {
    const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1]?.toLowerCase() || ''
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href || !/icon/.test(rel)) return null
    const size = Number(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] || 0)
    return { href, score: (rel.includes('apple-touch') ? 400 : 0) + size }
  }).filter(Boolean).sort((a, b) => b.score - a.score)
  return rated[0]?.href || null
}

/** A company's own site mark. Small by nature, so it is a mark, not a photo. */
export async function siteIcon(website) {
  if (!website) return null
  let origin
  try { origin = new URL(website).origin } catch { return null }
  const href = iconHref(await getText(website, BROWSER_UA))
  const candidates = [href && new URL(href, website).href, `${origin}/apple-touch-icon.png`].filter(Boolean)
  for (const url of candidates) {
    const dims = await measureImage(url)
    if (!dims || Math.min(dims.width, dims.height) < 120) continue
    return {
      url,
      kind: 'logo',
      subject: 'item',
      credit: new URL(website).hostname.replace(/^www\./, ''),
      license: null,
      licenseUrl: null,
      source: 'site',
      sourceUrl: website,
      w: dims.width,
      h: dims.height,
    }
  }
  return null
}

// ── Which technology is this record about ───────────────────────────────────

/**
 * The class table. Each entry is a technology that Wikimedia Commons actually
 * photographs, the words a record uses when it is that technology, and the
 * search terms that find it. Order matters: specific before general.
 *
 * `re` is matched against everything a record says about itself, INCLUDING the
 * FDA's own name for its product code. A 510(k) row calls itself "Ceribell
 * Brain Monitor Headband" and says nothing else; its product code OMC is what
 * says "Reduced-Montage Electroencephalograph". Product codes take device
 * matching from 4 in 20 to 9 in 20.
 */
export const DEVICE_CLASSES = [
  { id: 'cochlear_implant', category: 'Cochlear implants', article: 'Cochlear implant', label: 'a cochlear implant', queries: ['cochlear implant'], re: /cochlear (implant|prosthes)/i },
  { id: 'dbs', category: 'Deep brain stimulation', article: 'Deep brain stimulation', label: 'a deep brain stimulation system (implanted brain electrodes or its pulse generator)', queries: ['deep brain stimulation', 'deep brain stimulation implant'], re: /deep brain stimulat|\bDBS\b|globus pallidus|subthalamic/i },
  { id: 'rns', category: 'Neurostimulators', article: 'Responsive neurostimulation device', label: 'an implanted neurostimulator for epilepsy (the device, its leads, or an X-ray of it in place)', queries: ['responsive neurostimulation epilepsy', 'neurostimulator implant epilepsy', 'NeuroPace', 'epilepsy neurostimulator'], re: /responsive neurostimulat|\bRNS\b/i },
  { id: 'vns', category: 'Vagus nerve stimulation', article: 'Vagus nerve stimulation', label: 'a vagus nerve stimulator (implanted pulse generator and lead)', queries: ['vagus nerve stimulator implant', 'vagus nerve stimulation'], re: /vagus|vagal|\b(?:ta|t|n|c)?VNS\b/i },
  { id: 'scs', category: 'Spinal cord stimulation', article: 'Spinal cord stimulator', label: 'a spinal cord stimulator', queries: ['spinal cord stimulator', 'spinal cord stimulation implant'], re: /spinal cord stimulat|\bSCS\b|dorsal column stimulat/i },
  { id: 'tms', category: 'Transcranial magnetic stimulation', article: 'Transcranial magnetic stimulation', label: 'transcranial magnetic stimulation: a TMS coil or stimulator, either as hardware or held against a head', queries: ['transcranial magnetic stimulation', 'transcranial magnetic stimulation coil', 'TMS therapy treatment', 'magnetic stimulation coil head'], re: /transcranial magnetic|\b(?:r|i|a|c|d|s)?TMS\b|theta burst|\biTBS\b/i, titleAlso: /stimulation coil|double cone coil/i },
  { id: 'tdcs', category: 'Transcranial direct current stimulation', article: 'Transcranial direct-current stimulation', label: 'transcranial electrical stimulation electrodes on a head', queries: ['transcranial direct current stimulation', 'tDCS electrodes head'], re: /transcranial direct current|\b(?:hd-?)?t[DA]CS\b|transcranial electrical|\btRNS\b/i },
  { id: 'tens', category: 'Transcutaneous electrical nerve stimulation', article: 'Transcutaneous electrical nerve stimulation', label: 'a transcutaneous electrical nerve stimulation (TENS) unit with skin electrodes', queries: ['TENS unit electrodes', 'transcutaneous electrical nerve stimulation'], re: /(transcutaneous[\s\S]{0,40}nerve|nerve[\s\S]{0,40}transcutaneous)|\bTENS\b|tongue stimulator/i },
  { id: 'pns', category: 'Neurostimulators', article: 'Peripheral nerve stimulation', label: 'an implanted or wearable peripheral nerve stimulator', queries: ['peripheral nerve stimulation', 'tibial nerve stimulation', 'nerve stimulator wearable'], re: /peripheral nerve stimulat|occipital nerve stimulat|tremor stimulator|\bPNS system\b/i, titleAlso: /nerve stimulat/i },
  { id: 'retinal', category: 'Retinal implants', article: 'Retinal implant', label: 'a retinal implant or bionic eye', queries: ['retinal implant', 'Argus II retinal prosthesis', 'retinal prosthesis device'], re: /retinal (implant|prosthes)|bionic eye/i, titleAlso: /retina|argus/i },
  { id: 'ecog', category: 'Electrocorticography', article: 'Electrocorticography', label: 'an electrocorticography electrode grid', queries: ['electrocorticography electrode grid', 'subdural electrode grid', 'intracranial electrodes epilepsy', 'ECoG electrode array'], re: /electrocorticograph|\bECoG\b|subdural (grid|electrode)/i },
  { id: 'mea', category: 'Microelectrode arrays', article: 'Microelectrode array', label: 'a microelectrode array used to record neurons', queries: ['microelectrode array neural', 'Utah electrode array', 'multielectrode array chip', 'neural probe silicon'], re: /microelectrode array|utah array|intracortical (array|electrode)|penetrating electrode/i, titleAlso: /electrode array|neural probe/i },
  { id: 'eeg', category: 'Electroencephalography', article: 'Electroencephalography', label: 'electroencephalography: an EEG cap, EEG electrodes on a scalp, or an EEG recording', queries: ['electroencephalography cap', 'EEG electrodes head', 'electroencephalography'], re: /electroencephalograph|\bEEG\b|evoked potential|polysomnograph/i },
  { id: 'meg', category: 'Magnetoencephalography', article: 'Magnetoencephalography', label: 'a magnetoencephalography scanner', queries: ['magnetoencephalography'], re: /magnetoencephalograph|\bMEG\b/i },
  { id: 'fnirs', category: 'Functional near-infrared spectroscopy', article: 'Functional near-infrared spectroscopy', label: 'a functional near-infrared spectroscopy headset', queries: ['functional near-infrared spectroscopy brain', 'fNIRS headset'], re: /near-?infrared spectroscop|\bfNIRS\b/i },
  { id: 'mri', category: 'MRI scanners', article: 'Magnetic resonance imaging', label: 'a magnetic resonance imaging scanner or an MRI brain scan', queries: ['magnetic resonance imaging scanner', 'MRI brain scan'], re: /magnetic resonance imag|\bfMRI\b|\bMRI\b|neuroimaging/i },
  { id: 'emg', category: 'Electromyography', article: 'Electromyography', label: 'electromyography: surface EMG electrodes or an EMG recording', queries: ['electromyography electrodes', 'electromyography'], re: /electromyograph|\bEMG\b|biofeedback analyzer|evoked response/i },
  { id: 'fus', category: 'High-intensity focused ultrasound', article: 'High-intensity focused ultrasound', label: 'a focused ultrasound therapy or ultrasound neuromodulation system', queries: ['focused ultrasound therapy', 'MRI guided focused ultrasound', 'high intensity focused ultrasound machine', 'ultrasound therapy device'], re: /focused ultrasound|ultrasound neuromodulat/i, titleAlso: /focused ultrasound|\bHIFU\b/i },
  { id: 'exoskeleton', category: 'Powered exoskeletons', article: 'Powered exoskeleton', label: 'a powered exoskeleton or robotic gait trainer worn by a person', queries: ['powered exoskeleton rehabilitation', 'robotic gait trainer'], re: /exoskelet|gait trainer|robotic gait/i },
  { id: 'prosthetic', category: 'Myoelectric prostheses', article: 'Myoelectric prosthesis', label: 'a myoelectric prosthetic arm or hand', queries: ['myoelectric prosthetic arm', 'prosthetic hand'], re: /myoelectric|prosthetic (arm|hand|limb)|limb prosthes/i },
  { id: 'electrode', category: 'Medical electrodes', article: 'Electrode', label: 'medical skin electrodes attached to a body', queries: ['medical electrodes skin', 'surface electrodes patient', 'ECG electrodes chest', 'electrode pads body'], re: /electrode, cutaneous|cutaneous electrode|surface electrode|\bcup electrode/i, titleAlso: /electrode/i },
  { id: 'optogenetics', category: 'Optogenetics', article: 'Optogenetics', label: 'optogenetics: laser or fibre-optic hardware for stimulating neurons, or fluorescently labelled brain tissue', queries: ['optogenetics', 'optogenetic stimulation'], re: /optogenetic|channelrhodopsin|photostimulat/i },
  { id: 'microscopy', category: 'Neurons', article: 'Neuron', label: 'neurons or brain tissue seen under a microscope', queries: ['neuron microscopy', 'neurons fluorescence microscopy'], re: /microscop|two-photon|calcium imaging|immunostain|histolog|transcriptom|single-cell|organoid|photoreceptor|retina\b/i, titleAlso: /neuron|dendrit|axon|purkinje|glia|pyramidal cell/i },
  { id: 'spinal', category: 'Spinal cord', article: 'Spinal cord injury', label: 'the spinal cord, a spine, or spinal surgery', queries: ['spinal cord', 'spinal cord injury rehabilitation'], re: /spinal cord|spine\b|tetrapleg|parapleg/i, titleAlso: /spinal|spine|vertebr|myelon/i },
  { id: 'bci', category: 'Brain-computer interfacing', article: 'Brain–computer interface', label: 'a brain-computer interface in use: a person wearing or implanted with a neural interface', queries: ['brain computer interface', 'brain computer interface user'], re: /brain[- ]computer interface|brain[- ]machine interface|\bBCI\b|neural interface|neuroprosthe|neuralink|synchron|precision neuroscience|paradromics|blackrock neurotech|motif neurotech|onward medical/i },
  // The catch-all, deliberately last. A record about the nervous system that
  // names no instrument still gets a picture of the nervous system, labelled
  // as the illustration it is. Anything more specific above wins first.
]

/**
 * The fields that name a technology, as one searchable string.
 *
 * Deliberately NOT the summary or the condition list. A trial of an oral drug
 * for Parkinson's mentions deep brain stimulation in its background prose and
 * lists "Parkinson's Disease" as its condition, and matching on either put a
 * photograph of a DBS X-ray on a card about a tablet. What a record is
 * *about* lives in its title, its interventions, its device name and its FDA
 * product code. Pure.
 */
export function recordText(entity = {}, extra = '') {
  const m = entity.metadata || {}
  // Joined with a separator no phrase can span. Joining with a space invented
  // phrases that were never in the record: a paper tagged ["Ultrasound",
  // "Neuromodulation"] read as "ultrasound neuromodulation" and took a
  // photograph of ultrasound transducers onto a paper about magnetic fields.
  return [
    entity.name, entity.title, entity.description,
    entity.manufacturer, entity.product_code, extra,
    ...(m.interventions || []), ...(entity.topics || []),
  ].filter(Boolean).join(' | ')
}

/** The technology class a record is about, or null. Pure. */
/**
 * There is no general fallback, deliberately.
 *
 * A pool of generic brain pictures was built and thrown away twice. Sourced
 * from the obvious categories it fills with autopsy specimens, tumour scans
 * and haemorrhages: grim, and a clinical claim the record never made. Sourced
 * more carefully it fills with multi-panel figures lifted from open-access
 * papers, which are unreadable at card size. Neither belongs on a news page,
 * and a card showing a picture of nothing in particular is worse than a card
 * showing the record's own numbers.
 *
 * So a record whose technology has no photograph keeps its data figure.
 */
export const FALLBACK_CLASS = null

export function classifyTechnology(entity, extra = '') {
  const text = recordText(entity, extra)
  return DEVICE_CLASSES.find(c => c.re.test(text)) || null
}

// ── openFDA product codes: what a 510(k) record actually is ─────────────────

const CODE_CACHE = join(HERE, '../data/fda-product-codes.json')
let codeCache = null

const loadCodes = () => {
  if (codeCache) return codeCache
  try { codeCache = existsSync(CODE_CACHE) ? JSON.parse(readFileSync(CODE_CACHE, 'utf8')) : {} } catch { codeCache = {} }
  return codeCache
}
export const saveProductCodes = () => {
  if (codeCache) writeFileSync(CODE_CACHE, JSON.stringify(codeCache, null, 2) + '\n')
}

/** The FDA's own name and definition for a product code, cached on disk.
 *  Null is cached too, so a code with no classification is asked once. */
export async function productCodeText(code) {
  if (!code) return ''
  const cache = loadCodes()
  if (code in cache) return cache[code] || ''
  const r = await getJson(`https://api.fda.gov/device/classification.json?search=product_code:"${encodeURIComponent(code)}"&limit=1`)
  const rec = r?.results?.[0]
  cache[code] = rec ? `${rec.device_name || ''} ${rec.definition || ''}`.trim() : null
  return cache[code] || ''
}

// ── The resolvers each entity type uses ─────────────────────────────────────

/**
 * The first class photograph a vision model confirms shows the technology.
 * Candidates come from several search terms because Commons ranks by text
 * match, not by whether the file is a photograph of the thing.
 */
export async function classImage(cls, { maxChecks = 4 } = {}) {
  if (!cls) return null
  const seen = new Set()
  let checks = 0
  for (const query of cls.queries) {
    for (const cand of await commonsSearch(query)) {
      if (seen.has(cand.url) || checks >= maxChecks) continue
      seen.add(cand.url)
      checks++
      if (await confirmSinglePhoto(cand.url) && await confirmDepicts(cand.url, cls.label)) {
        const { title, ...img } = cand
        return { ...img, classId: cls.id, classLabel: cls.label, classTitle: title }
      }
    }
    if (checks >= maxChecks) break
  }
  return null
}

/**
 * Several confirmed photographs for one class, not just the first.
 *
 * A class image is resolved ONCE and reused by every record of that class:
 * three thousand FDA clearances do not need three thousand Commons searches,
 * and they certainly do not need three thousand vision calls. A pool of a few
 * per class also keeps a page of eight EEG devices from being the same
 * photograph eight times.
 */
/**
 * Does the file's own name say it is this technology?
 *
 * Two independent things have to agree before a photograph may stand for a
 * technology: the uploader's title and a vision model. Either alone is too
 * loose. Searching "peripheral nerve stimulation" surfaces cochlear implants,
 * and the model agrees a cochlear implant stimulates a nerve; searching
 * "focused ultrasound therapy" surfaces a cancer hyperthermia machine, and the
 * model agrees it is ultrasound hardware. Neither is the right picture, and in
 * both cases the title never claimed it was.
 *
 * The cost of the rule is classes with no picture at all. That is the correct
 * price: those records keep their data figure. Pure.
 */
/** Titles that announce a paper figure rather than a photograph. Commons holds
 *  thousands of them, uploaded from open-access articles. */
const FIGURE_TITLE = /overview of|study design|graphical abstract|\bfig(?:ure)?[\s._-]*\d|schematic|workflow|flow ?chart|panel|diagram|infographic/i

export function titleAffirmsClass(title, cls) {
  const t = String(title || '')
  if (FIGURE_TITLE.test(t)) return false
  // `titleAlso` covers classes whose files are named for the hardware rather
  // than the procedure: a TMS coil is filed under "double cone coil", a Utah
  // array under "electrode array".
  return cls.re.test(t) || Boolean(cls.titleAlso?.test(t))
}

export async function classImagePool(cls, { want = 3, maxChecks = Math.max(16, want * 3) } = {}) {
  if (!cls) return []
  const out = []
  const seen = new Set()
  let checks = 0

  // Wikipedia's article on the technology first. Its lead image was chosen by
  // editors to represent the topic, which is a better picture than anything a
  // text search ranks first, and the article's title is the affirmation that
  // Commons file names otherwise have to supply.
  if (cls.article) {
    const lead = await wikipediaImage(cls.article, { subject: 'class', minWidth: 330 })
    if (lead && (await confirmDepicts(lead.url, cls.label))) {
      seen.add(lead.url)
      out.push({ ...lead, classId: cls.id, classLabel: cls.label, classTitle: cls.article })
    }
  }

  // Three ways in, widest first. A curated Commons category and the body of
  // the Wikipedia article both hold pictures a text search never ranks: the
  // TMS category is full of photographs of machines and sessions, while
  // searching the same words returns the schematic that leads the article.
  const sources = [
    ...(cls.categories || (cls.category ? [cls.category] : [])).map(c => () => commonsCategory(c)),
    cls.article ? () => wikipediaArticleImages(cls.article) : null,
    ...cls.queries.map(q => () => commonsSearch(q)),
  ].filter(Boolean)

  for (const source of sources) {
    for (const cand of await source()) {
      if (out.length >= want || checks >= maxChecks) break
      if (seen.has(cand.url)) continue
      seen.add(cand.url)
      if (isRejected(cand.title)) continue
      if (!titleAffirmsClass(cand.title, cls)) continue
      checks++
      if (await confirmSinglePhoto(cand.url) && await confirmDepicts(cand.url, cls.label)) {
        const { title, ...img } = cand
        out.push({ ...img, classId: cls.id, classLabel: cls.label, classTitle: title })
      }
    }
    if (out.length >= want || checks >= maxChecks) break
  }
  return out
}

/**
 * Pictures a person looked at and turned down.
 *
 * Curation has to survive a rebuild. Twice now a rebuild has quietly
 * reinstated a picture that had already been rejected by eye, because the
 * builder replaces a class wholesale and the vision gate is not deterministic:
 * it drops a clean product photograph one run and passes a four-panel surgical
 * figure the next. The judgement lives in a file so it outlives the run that
 * made it.
 */
const REJECTS_PATH = join(HERE, '../../src/data/class-images-rejected.json')
let rejects = null
export function isRejected(title) {
  if (!rejects) {
    try { rejects = Object.keys(JSON.parse(readFileSync(REJECTS_PATH, 'utf8'))).filter(k => !k.startsWith('_')) } catch { rejects = [] }
  }
  const t = String(title || '')
  return rejects.some(r => t.includes(r))
}

/** The pool file: the reviewed set of class photographs, kept in the repo so a
 *  human can see exactly which picture stands for which technology. */
// The pool lives with the app's data, not the scripts', because the page reads
// it too: when two cards land on the same class photograph the second picks a
// different one from the same pool rather than dropping to a data figure.
const POOL_PATH = join(HERE, '../../src/data/class-images.json')
export function loadClassImages() {
  try { return existsSync(POOL_PATH) ? JSON.parse(readFileSync(POOL_PATH, 'utf8')) : {} } catch { return {} }
}
export function saveClassImages(pool) {
  writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2) + '\n')
}

/** Stable string hash, so a record keeps the same picture between runs. */
function hash(s = '') {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** One picture from a class's pool, chosen by the record's id so the choice is
 *  stable across runs and spread across the pool. */
export function pickClassImage(pool, classId, seedKey = '') {
  const list = pool?.[classId]?.images || []
  return list.length ? list[hash(String(seedKey)) % list.length] : null
}

/**
 * A paper's own figure: the preprint servers first, then PMC. A paywalled
 * paper returns null, because its figures are not ours to show.
 */
export async function resolvePaperImage(item) {
  const doi = item.metadata?.doi || item.doi
  const pmid = item.metadata?.pmid || item.pmid
  const arxivId = item.metadata?.arxivId || item.arxivId
  return (await preprintFigure({ url: item.url, doi }))
    || (arxivId ? await arxivFigure(arxivId) : null)
    || (await europePmcFigure({ doi, pmid }))
    || null
}

/**
 * A device's picture, best first.
 *
 *   1. the Wikipedia article about this exact device, when one exists
 *   2. the product's page on the site of the company that makes it, which is
 *      the product photographed by the people who build it
 *   3. a labelled photograph of the technology
 *
 * `website` is the maker's site, which the caller looks up: openFDA gives a
 * manufacturer's NAME and no URL, and the organizations table is where the
 * URLs are.
 */
export async function resolveDeviceImage(device, { website = null } = {}) {
  const name = productName(device)
  const own = (await wikipediaImage(name))
    || (website ? await siteProductImage(website, name) : null)
  if (own) return own
  const cls = classifyTechnology(device, await productCodeText(device.product_code))
  return classImage(cls)
}

/**
 * The named products among a trial's interventions.
 *
 * "Repetitive transcranial magnetic stimulation" is a technique and belongs to
 * the class photographs; "Nerivio" is a product and has a photograph of its
 * own. The difference is that a technique is in the class vocabulary and a
 * product is a proper noun that is not. Pure.
 */
export function productLikeNames(trial = {}) {
  const raw = [...(trial.metadata?.interventions || [])]
  return raw
    .map(s => String(s).replace(/\b(device|therapy|treatment|system)\b\s*$/i, '').trim())
    .filter(s => s.length > 3 && s.split(/\s+/).length <= 4)
    .filter(s => /[A-Z]/.test(s))                                  // a name, not a description
    .filter(s => !DEVICE_CLASSES.some(c => c.re.test(s)))          // a technique, not a product
    .filter(s => !/^(placebo|sham|control|standard|usual|saline|blood|questionnaire|survey)/i.test(s))
}

/**
 * A trial's picture, best first.
 *
 *   1. the product under test: the Wikipedia article about it, or its page on
 *      the sponsor's own site. Nothing represents a trial better than a
 *      photograph of the thing being trialled.
 *   2. a labelled photograph of the technique it uses.
 */
export async function resolveTrialImage(trial, { sponsorSite = null } = {}) {
  for (const name of productLikeNames(trial).slice(0, 2)) {
    const own = (await wikipediaImage(name))
      || (sponsorSite ? await siteProductImage(sponsorSite, name) : null)
    if (own) return own
  }
  return classImage(classifyTechnology(trial))
}

/** A company's own mark: its Wikidata logo, else its site's icon. */
export async function resolveOrgImage(org) {
  return (await wikidataLogo(org.display_name || org.name)) || (await siteIcon(org.website)) || null
}

/**
 * The last resort for any record: a labelled photograph of the technology it
 * is about. Used when nothing of the record's own could be sourced.
 */
export async function resolveClassImage(entity, extra = '') {
  return classImage(classifyTechnology(entity, extra))
}
