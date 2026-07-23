/**
 * build-productcode-map.js — resolve every FDA product code present in the
 * `devices` table to its official FDA classification, and draft a facet
 * mapping from the official device name.
 *
 * The device ingest currently formats the product code into a sentence and
 * then classifies devices by regex over their trade name. The product code is
 * the regulator's own classification, is present on 100% of rows, and takes
 * only 187 distinct values — so it should drive scope and facets instead.
 *
 *   node --env-file=.env scripts/build-productcode-map.js
 *
 * Writes docs/product-code-map.json — a review-ready draft. The `facets` field
 * is a keyword-derived SUGGESTION over the official device name; a human
 * confirms each row once, and thereafter it is authoritative.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Collect the product codes actually present ──────────────────────────────
const counts = {}
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('devices').select('description').range(f, f + 999)
  if (error) { console.error(error.message); break }
  if (!data?.length) break
  for (const d of data) {
    const m = /product code ([A-Z]{3})/.exec(d.description || '')
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1
  }
  if (data.length < 1000) break
}
const codes = Object.keys(counts).sort()
console.log(`${codes.length} distinct product codes across ${Object.values(counts).reduce((a, b) => a + b, 0)} devices`)

// ── Resolve each against the FDA device classification database ─────────────
const info = {}
for (let i = 0; i < codes.length; i += 20) {
  const batch = codes.slice(i, i + 20)
  const q = batch.map(c => `product_code:${c}`).join('+OR+')
  const url = `https://api.fda.gov/device/classification.json?search=${q}&limit=100`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'NeuroBaseBot/1.0' } })
    if (res.ok) {
      const d = await res.json()
      for (const r of d.results || []) {
        info[r.product_code] = {
          name: r.device_name,
          definition: (r.definition || '').slice(0, 400),
          specialty: r.medical_specialty_description,
          regulation: r.regulation_number,
          deviceClass: r.device_class,
        }
      }
    }
  } catch (e) { console.warn(`  batch ${i}: ${e.message}`) }
  process.stdout.write(`\r  resolved ${Object.keys(info).length}/${codes.length}`)
  await sleep(250)
}
console.log('')

// ── Draft facet suggestions from the OFFICIAL device name ───────────────────
// Short, controlled vocabulary written by the FDA — far cleaner than trade names.
const rule = (re, val) => ({ re: new RegExp(re, 'i'), val })
const FN = [
  rule('stimulat|pacemaker|neuromodulat|magnetotherap|iontophoresis', 'stimulates'),
  rule('electroencephalograph|electromyograph|recorder|monitor|evoked response|electrode.*(record|diagnos)|nerve conduction|polysomnograph|electrocorticograph', 'records'),
  rule('tomograph|imaging|magnetic resonance|scanner|spectroscop', 'images'),
  rule('brain.?computer|signal.*(interpret|decod)', 'decodes'),
]
const AX = [
  rule('implant|implanted|implantable', 'implanted_non_penetrating'),
  rule('depth electrode|intracortical|penetrating', 'implanted_penetrating'),
  rule('percutaneous|endovascular|catheter', 'minimally_invasive'),
  rule('cutaneous|transcutaneous|external|scalp|surface|non-?invasive|helmet', 'non_invasive'),
]
const AP = [
  rule('epilep|seizure', 'epilepsy'),
  rule('pain|analges', 'pain'),
  rule('tremor|parkinson|dystonia', 'movement_disorders'),
  rule('cochlear|auditory|hearing|retinal|visual prosthes', 'sensory_restoration'),
  rule('rehabilit|muscle stimulator|functional electrical', 'rehabilitation'),
  rule('diagnos|monitor|measur|evoked|nerve conduction|electroencephalograph', 'diagnostics'),
  rule('incontinence|bladder|gastric|diaphragm|phrenic|vagus|vagal', 'autonomic_organ'),
  rule('depress|psychiatr|obsessive', 'psychiatric'),
  rule('prosthes|paralysis|limb', 'movement_restoration'),
]
const apply = (rules, text) => [...new Set(rules.filter(r => r.re.test(text)).map(r => r.val))]

// Codes whose official name shows they are not neurotechnology at all.
const OUT_OF_SCOPE = /suction|drill|burr|dura|gel$|paste|cream|coil|embol|catheter guide|navigation|stereotaxic instrument|helmet|cranial (plate|fixation)|forceps|retractor|shunt|scalpel|marker|tray|table|lamp|glove|drape/i

const map = {}
for (const code of codes) {
  const i = info[code]
  if (!i) { map[code] = { devices: counts[code], resolved: false, review: 'not found in FDA classification DB' }; continue }
  const text = `${i.name} ${i.definition}`
  const fn = apply(FN, text), ax = apply(AX, text), ap = apply(AP, text)
  map[code] = {
    devices: counts[code],
    name: i.name,
    specialty: i.specialty,
    regulation: i.regulation,
    fdaClass: i.deviceClass,
    inScope: !OUT_OF_SCOPE.test(i.name) && (fn.length > 0),
    facets: { function: fn, access: ax, application: ap },
    review: 'DRAFT — confirm once, then authoritative',
  }
}

writeFileSync(join(HERE, '../docs/product-code-map.json'), JSON.stringify(map, null, 2))

const resolved = codes.filter(c => info[c]).length
const inScope = codes.filter(c => map[c].inScope)
const devIn = inScope.reduce((a, c) => a + counts[c], 0)
const devAll = Object.values(counts).reduce((a, b) => a + b, 0)
console.log(`resolved ${resolved}/${codes.length} codes`)
console.log(`draft in-scope: ${inScope.length} codes covering ${devIn}/${devAll} devices (${(100 * devIn / devAll).toFixed(0)}%)`)
console.log('\ntop codes by device count:')
for (const c of codes.sort((a, b) => counts[b] - counts[a]).slice(0, 18)) {
  const m = map[c]
  console.log(`  ${c} ${String(counts[c]).padStart(4)}  ${m.inScope ? 'IN ' : 'out'}  ${(m.name || '?').slice(0, 52).padEnd(53)} ${(m.facets?.function || []).join('+')}`)
}
