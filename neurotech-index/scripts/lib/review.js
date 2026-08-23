/**
 * review.js — the picture decisions a person (or an agent acting as one) has
 * made, and the queue of pictures still waiting for one.
 *
 * This file exists because of a constraint and a principle that happen to
 * agree. The constraint: the pipeline no longer calls a model API, so no step
 * in the nightly run can look at an image. The principle, which this project
 * already held: a picture goes on the page because somebody looked at it, not
 * because a search engine returned it. Commons answers "microelectrode array"
 * with a file called Mea Culpa.JPG.
 *
 * So judgement is made OFFLINE, by the daily reviewer (see
 * `.claude/skills/refresh-home-images`), and written here as data. The nightly
 * run reads it and does arithmetic. Nothing in `scripts/` calls a model.
 *
 * The four questions asked of every candidate, kept separate because a
 * combined question lets them blur:
 *
 *   photo    a photograph, micrograph or scan of real subject matter — not a
 *            chart, schematic, logo, patent drawing or rendering. A card that
 *            already carries a data figure gains nothing from a second one.
 *   single   ONE image, not a grid of lettered panels. Figure 1 of a paper is
 *            nearly always a composite; at card size a composite is grey noise.
 *   safe     a general news page could run it beside a headline without
 *            warning a reader. Exposed tissue, surgery in progress, cadavers.
 *   depicts  it is a picture OF the thing it was queued for — this story, this
 *            paper, this technology. The queue entry carries the title so the
 *            reviewer can answer it.
 *
 * `depicts` was added on 23 Aug 2026, in the first review pass, because the
 * first three let something through that the home page's own rule forbids.
 * Frontiers illustrates every journal with a posed stock photograph of an EEG
 * session; it is a photograph, it is one image, and it is perfectly safe. It
 * was queued for a paper about deep brain stimulation electrodes in surgery,
 * which it has nothing to do with. Without a question that can say "not of
 * this", a journal's masthead art becomes the picture on somebody's research.
 *
 * `box` is the subject's extent, which src/lib/crop.js turns into an
 * object-position. It is a BOX and not a centre point on purpose — see the
 * note in crop.js.
 *
 * **Unreviewed means no.** `verdict` returns null for a picture nobody has
 * looked at, and every caller treats null as a rejection and queues it. That
 * is the whole safety property: a picture cannot reach the page by being
 * fetched, only by being reviewed. The cost is a day's latency on a new
 * source, which the queue is there to close.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { keyOf } from '../../src/lib/ledger.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REVIEW_PATH = join(HERE, '../../src/data/image-review.json')

const EMPTY = { version: 1, decisions: {}, pending: [] }

export function load(path = REVIEW_PATH) {
  if (!existsSync(path)) return structuredClone(EMPTY)
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'))
    return { ...EMPTY, ...j, decisions: j.decisions || {}, pending: j.pending || [] }
  } catch {
    return structuredClone(EMPTY)
  }
}

export function save(store, path = REVIEW_PATH) {
  writeFileSync(path, JSON.stringify(store, null, 2) + '\n')
}

/** The decision recorded for a picture, or null if nobody has looked at it. */
export function verdict(store, url) {
  return store?.decisions?.[keyOf(url)] || null
}

/**
 * May this picture be published at all?
 *
 * All four questions have to answer yes. A picture that fails any of them is
 * still a recorded decision, which is what stops the pipeline re-queueing it
 * every night for the rest of its life.
 *
 * `depicts` defaults to false when a decision predates the field rather than
 * to true, because the whole point of the gate is that silence is not consent.
 */
export function approved(store, url) {
  const v = verdict(store, url)
  return Boolean(v && v.photo && v.single && v.safe && v.depicts)
}

/** Has anyone ruled on this picture, either way? */
export const decided = (store, url) => Boolean(verdict(store, url))

/** The subject's extent, for the crop. Null when unreviewed or unrecorded. */
export function box(store, url) {
  const v = verdict(store, url)
  return v?.box || null
}

/**
 * Put a picture in front of the reviewer.
 *
 * Deduped on the picture, and skipped outright for anything already decided:
 * the queue is work, and re-queueing a picture that was turned down in April
 * is not work. `why` and `title` are the context the reviewer needs to answer
 * the fourth question, which is not about the picture at all — does it belong
 * beside THIS headline — and which is why the item is carried alongside.
 */
export function queue(store, url, { item = null, title = null, why = null, at = null } = {}) {
  const key = keyOf(url)
  if (!key || decided(store, url)) return store
  const pending = store.pending || []
  if (pending.some(p => keyOf(p.url) === key)) return store
  return { ...store, pending: [...pending, { url, item, title, why, at }] }
}

/** Record a decision and drop the picture from the queue. */
export function decide(store, url, { photo, single, safe, depicts, box: extent = null, note = null, at = null } = {}) {
  const key = keyOf(url)
  if (!key) return store
  return {
    ...store,
    decisions: {
      ...store.decisions,
      [key]: { url, photo: !!photo, single: !!single, safe: !!safe, depicts: !!depicts, box: extent, note, at },
    },
    pending: (store.pending || []).filter(p => keyOf(p.url) !== key),
  }
}

/**
 * The queue, most urgent first.
 *
 * The order is by what is at stake if the reviewer runs out of time today:
 *
 *   0  a picture that is ALREADY ON THE PAGE and has never been ruled on. It is
 *      in front of readers right now, so it is the only kind where waiting has
 *      a cost that is already being paid.
 *   1  a candidate for a story that currently has no picture — a blank frame
 *      tonight, which is a fair page, just a thinner one.
 *   2  everything else, including "where is the subject", which only refines a
 *      crop on a picture that is already publishable.
 */
const URGENCY = { 'already on the page, never reviewed': 0, 'no picture': 1 }

export function pending(store, limit = Infinity) {
  const rank = p => URGENCY[p.why] ?? (p.why === 'where is the subject' ? 3 : 2)
  return [...(store.pending || [])].sort((a, b) => rank(a) - rank(b)).slice(0, limit)
}
