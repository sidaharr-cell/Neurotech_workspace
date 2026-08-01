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

/** The bar for a card. Journal figures are often modest; 450px still reads
 *  cleanly in a 4:3 card and refusing them would throw away most of PMC. */
export const CARD_RES = d => !!d && Math.max(d.width, d.height) >= 450

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
export async function confirmDepicts(url, label) {
  const a = await ask(url, `Is this a PHOTOGRAPH (or a medical scan such as an X-ray or MRI) showing ${label}? Reply YES only if a reader would recognise the actual hardware, or a person wearing or implanted with it. Reply NO if it is a diagram, illustration, schematic, patent drawing, chart, book or document scan, logo, screenshot, or shows something else. Exactly one word: YES or NO.`)
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
      if (!info?.url || !(info.mime || '').startsWith('image/')) return null
      if ((info.width || 0) < minWidth) return null
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

/** One named Commons file (used for Wikidata logo claims). */
export async function commonsFile(fileName, { subject = 'item', minWidth = 0 } = {}) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + `&titles=File:${encodeURIComponent(fileName)}&${COMMONS_PROPS}`
  return parseCommons(await getJson(url), { subject, minWidth })[0] || null
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
  { id: 'cochlear_implant', label: 'a cochlear implant', queries: ['cochlear implant'], re: /cochlear (implant|prosthes)/i },
  { id: 'dbs', label: 'a deep brain stimulation system (implanted brain electrodes or its pulse generator)', queries: ['deep brain stimulation', 'deep brain stimulation implant'], re: /deep brain stimulat|\bDBS\b|globus pallidus|subthalamic/i },
  { id: 'rns', label: 'an implanted neurostimulator for epilepsy (the device, its leads, or an X-ray of it in place)', queries: ['responsive neurostimulation epilepsy', 'neurostimulator implant epilepsy', 'NeuroPace', 'epilepsy neurostimulator'], re: /responsive neurostimulat|\bRNS\b/i },
  { id: 'vns', label: 'a vagus nerve stimulator (implanted pulse generator and lead)', queries: ['vagus nerve stimulator implant', 'vagus nerve stimulation'], re: /vagus|vagal|\bVNS\b/i },
  { id: 'scs', label: 'a spinal cord stimulator', queries: ['spinal cord stimulator', 'spinal cord stimulation implant'], re: /spinal cord stimulat|\bSCS\b|dorsal column stimulat/i },
  { id: 'tms', label: 'transcranial magnetic stimulation: a TMS coil or stimulator, either as hardware or held against a head', queries: ['transcranial magnetic stimulation', 'transcranial magnetic stimulation coil', 'TMS therapy treatment', 'magnetic stimulation coil head'], re: /transcranial magnetic|\b[ri]?TMS\b|theta burst/i, titleAlso: /stimulation coil|double cone coil/i },
  { id: 'tdcs', label: 'transcranial electrical stimulation electrodes on a head', queries: ['transcranial direct current stimulation', 'tDCS electrodes head'], re: /transcranial direct current|\btDCS\b|\btACS\b|transcranial electrical/i },
  { id: 'tens', label: 'a transcutaneous electrical nerve stimulation (TENS) unit with skin electrodes', queries: ['TENS unit electrodes', 'transcutaneous electrical nerve stimulation'], re: /(transcutaneous[\s\S]{0,40}nerve|nerve[\s\S]{0,40}transcutaneous)|\bTENS\b|tongue stimulator/i },
  { id: 'pns', label: 'an implanted or wearable peripheral nerve stimulator', queries: ['peripheral nerve stimulation', 'tibial nerve stimulation', 'nerve stimulator wearable'], re: /peripheral nerve stimulat|occipital nerve stimulat|tremor stimulator|\bPNS system\b/i, titleAlso: /nerve stimulat/i },
  { id: 'retinal', label: 'a retinal implant or bionic eye', queries: ['retinal implant', 'Argus II retinal prosthesis', 'retinal prosthesis device'], re: /retinal (implant|prosthes)|bionic eye/i, titleAlso: /retina|argus/i },
  { id: 'ecog', label: 'an electrocorticography electrode grid', queries: ['electrocorticography electrode grid', 'subdural electrode grid', 'intracranial electrodes epilepsy', 'ECoG electrode array'], re: /electrocorticograph|\bECoG\b|subdural (grid|electrode)/i },
  { id: 'mea', label: 'a microelectrode array used to record neurons', queries: ['microelectrode array neural', 'Utah electrode array', 'multielectrode array chip', 'neural probe silicon'], re: /microelectrode array|utah array|intracortical (array|electrode)|penetrating electrode/i, titleAlso: /electrode array|neural probe/i },
  { id: 'eeg', label: 'electroencephalography: an EEG cap, EEG electrodes on a scalp, or an EEG recording', queries: ['electroencephalography cap', 'EEG electrodes head', 'electroencephalography'], re: /electroencephalograph|\bEEG\b|evoked potential|polysomnograph/i },
  { id: 'meg', label: 'a magnetoencephalography scanner', queries: ['magnetoencephalography'], re: /magnetoencephalograph|\bMEG\b/i },
  { id: 'fnirs', label: 'a functional near-infrared spectroscopy headset', queries: ['functional near-infrared spectroscopy brain', 'fNIRS headset'], re: /near-?infrared spectroscop|\bfNIRS\b/i },
  { id: 'mri', label: 'a magnetic resonance imaging scanner or an MRI brain scan', queries: ['magnetic resonance imaging scanner', 'MRI brain scan'], re: /magnetic resonance imag|\bfMRI\b|\bMRI\b|neuroimaging/i },
  { id: 'emg', label: 'electromyography: surface EMG electrodes or an EMG recording', queries: ['electromyography electrodes', 'electromyography'], re: /electromyograph|\bEMG\b|biofeedback analyzer|evoked response/i },
  { id: 'fus', label: 'a focused ultrasound therapy or ultrasound neuromodulation system', queries: ['focused ultrasound therapy', 'MRI guided focused ultrasound', 'high intensity focused ultrasound machine', 'ultrasound therapy device'], re: /focused ultrasound|ultrasound neuromodulat/i, titleAlso: /focused ultrasound|\bHIFU\b/i },
  { id: 'exoskeleton', label: 'a powered exoskeleton or robotic gait trainer worn by a person', queries: ['powered exoskeleton rehabilitation', 'robotic gait trainer'], re: /exoskelet|gait trainer|robotic gait/i },
  { id: 'prosthetic', label: 'a myoelectric prosthetic arm or hand', queries: ['myoelectric prosthetic arm', 'prosthetic hand'], re: /myoelectric|prosthetic (arm|hand|limb)|limb prosthes/i },
  { id: 'electrode', label: 'medical skin electrodes attached to a body', queries: ['medical electrodes skin', 'surface electrodes patient', 'ECG electrodes chest', 'electrode pads body'], re: /electrode, cutaneous|cutaneous electrode|surface electrode|\bcup electrode/i, titleAlso: /electrode/i },
  { id: 'bci', label: 'a brain-computer interface in use: a person wearing or implanted with a neural interface', queries: ['brain computer interface', 'brain computer interface user'], re: /brain[- ]computer interface|brain[- ]machine interface|\bBCI\b|neural interface|neuroprosthe/i },
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
  return [
    entity.name, entity.title, entity.description,
    entity.manufacturer, entity.product_code, extra,
    ...(m.interventions || []), ...(entity.topics || []),
  ].filter(Boolean).join(' ')
}

/** The technology class a record is about, or null. Pure. */
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
      if (await confirmDepicts(cand.url, cls.label)) {
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
export function titleAffirmsClass(title, cls) {
  const t = String(title || '')
  // `titleAlso` covers classes whose files are named for the hardware rather
  // than the procedure: a TMS coil is filed under "double cone coil", a Utah
  // array under "electrode array".
  return cls.re.test(t) || Boolean(cls.titleAlso?.test(t))
}

export async function classImagePool(cls, { want = 3, maxChecks = 16 } = {}) {
  if (!cls) return []
  const out = []
  const seen = new Set()
  let checks = 0
  for (const query of cls.queries) {
    for (const cand of await commonsSearch(query)) {
      if (out.length >= want || checks >= maxChecks) break
      if (seen.has(cand.url)) continue
      seen.add(cand.url)
      if (!titleAffirmsClass(cand.title, cls)) continue
      checks++
      if (await confirmDepicts(cand.url, cls.label)) {
        const { title, ...img } = cand
        out.push({ ...img, classId: cls.id, classLabel: cls.label, classTitle: title })
      }
    }
    if (out.length >= want || checks >= maxChecks) break
  }
  return out
}

/** The pool file: the reviewed set of class photographs, kept in the repo so a
 *  human can see exactly which picture stands for which technology. */
const POOL_PATH = join(HERE, '../data/class-images.json')
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
 * A paper's own figure: the preprint server first, then PMC. A paywalled paper
 * returns null, because its figures are not ours to show.
 */
export async function resolvePaperImage(item) {
  const doi = item.metadata?.doi || item.doi
  const pmid = item.metadata?.pmid || item.pmid
  return (await preprintFigure({ url: item.url, doi }))
    || (await europePmcFigure({ doi, pmid }))
    || null
}

/** A device's picture. There is no photograph of an individual 510(k)
 *  submission, so this is always a class photograph, labelled as one. */
export async function resolveDeviceImage(device) {
  const cls = classifyTechnology(device, await productCodeText(device.product_code))
  return classImage(cls)
}

/** A trial's picture: a class photograph, from its interventions. */
export async function resolveTrialImage(trial) {
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
