/**
 * build-class-images.js — resolve the reviewed pool of class photographs.
 *
 *   node --env-file-if-exists=.env scripts/build-class-images.js           # dry run
 *   node --env-file-if-exists=.env scripts/build-class-images.js --commit  # writes the JSON
 *   … --class=dbs,tms        only these classes
 *   … --want=3               images to keep per class
 *
 * A class photograph stands for a technology, not for one record: every deep
 * brain stimulation clearance shows the same small set of DBS photographs. So
 * the set is resolved ONCE, here, and written to src/data/class-images.json
 * where a person can read it and disagree with it. The backfill and the daily
 * cron then assign from that file at no API cost.
 *
 * Each candidate is confirmed by a vision model before it is kept, because
 * Commons ranks by text match: it answers "microelectrode array" with a file
 * called Mea Culpa.JPG and "vagus nerve" with a page of an 1897 physiology
 * textbook. Anything the model will not positively identify is dropped.
 */
import { DEVICE_CLASSES, classImagePool, loadClassImages, saveClassImages } from './lib/images.js'

const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const COMMIT = process.argv.includes('--commit')
const WANT = Number(arg('want', 3))
const ONLY = arg('class') ? new Set(arg('class').split(',')) : null

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required: every candidate is vision-confirmed before it is kept.')
  process.exit(1)
}

const pool = loadClassImages()
const classes = DEVICE_CLASSES.filter(c => !ONLY || ONLY.has(c.id))
console.log(`Resolving ${classes.length} classes, up to ${WANT} confirmed photographs each.\n`)

let found = 0, empty = []
for (const cls of classes) {
  const images = await classImagePool(cls, { want: WANT })
  if (!images.length) {
    empty.push(cls.id)
    console.log(`${cls.id.padEnd(16)} none confirmed`)
    continue
  }
  found += images.length
  pool[cls.id] = {
    label: cls.label,
    queries: cls.queries,
    resolvedAt: new Date().toISOString(),
    // Landscape first: a card crops to 4:3, so the pictures that survive that
    // crop best are the ones a record should be offered first.
    images: images
      .map(({ classLabel, ...i }) => i)
      .sort((a, b) => Math.abs((a.w || 1) / (a.h || 1) - 4 / 3) - Math.abs((b.w || 1) / (b.h || 1) - 4 / 3)),
  }
  for (const i of images) console.log(`${cls.id.padEnd(16)} ${String(i.classTitle).slice(0, 52).padEnd(54)} ${i.w}x${i.h} ${i.license}`)
}

console.log(`\n${found} photographs across ${classes.length - empty.length} classes.`)
if (empty.length) console.log(`No confirmable photograph for: ${empty.join(', ')} (records in these classes keep their data figure).`)

if (!COMMIT) {
  console.log('\nDry run. Re-run with --commit to write src/data/class-images.json.')
} else {
  saveClassImages(pool)
  console.log('\nWrote src/data/class-images.json.')
}
