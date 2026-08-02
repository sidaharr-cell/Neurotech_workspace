/**
 * audit-class-images.js — re-check every picture in the reviewed pool.
 *
 *   node --env-file-if-exists=.env scripts/audit-class-images.js
 *   node --env-file-if-exists=.env scripts/audit-class-images.js --commit   # drops the failures
 *
 * The pool is the one thing on the page that is reused, so a bad picture in it
 * is a bad picture many times over. This asks the two structural questions
 * (one photograph? fit to run?) and the depiction question again, so a gate
 * tightened later can be applied to what an earlier, looser gate let in.
 */
import { loadClassImages, saveClassImages, confirmSinglePhoto, confirmDepicts, DEVICE_CLASSES } from './lib/images.js'

const COMMIT = process.argv.includes('--commit')
const pool = loadClassImages()
const labelOf = id => DEVICE_CLASSES.find(c => c.id === id)?.label || id

let kept = 0, dropped = []
for (const [id, cls] of Object.entries(pool)) {
  const survivors = []
  for (const img of cls.images) {
    const single = await confirmSinglePhoto(img.url)
    const depicts = single && await confirmDepicts(img.url, labelOf(id))
    const name = String(img.classTitle || img.url.split('/').pop()).replace('File:', '').slice(0, 48)
    if (single && depicts) { survivors.push(img); kept++; console.log(`  keep ${id.padEnd(16)} ${name}`) }
    else { dropped.push(`${id} ${name} (${!single ? 'composite or graphic' : 'not the subject'})`); console.log(`  DROP ${id.padEnd(16)} ${name}`) }
  }
  cls.images = survivors
  if (!survivors.length) delete pool[id]
}

console.log(`\n${kept} kept, ${dropped.length} dropped`)
dropped.forEach(d => console.log(`  ${d}`))
if (COMMIT) { saveClassImages(pool); console.log('\nWrote src/data/class-images.json.') }
else console.log('\nDry run. Re-run with --commit to drop the failures.')
