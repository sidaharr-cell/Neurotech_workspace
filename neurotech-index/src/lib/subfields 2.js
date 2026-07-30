/**
 * subfields.js — the frontier-record partition.
 *
 * A subfield is the comparison scope for a FrontierRecord: an item is scored
 * against the records held in its own subfield, never against the whole corpus.
 * See docs/neurobase-potential-impact-build-spec-v1.0.md section 3.3.
 *
 * DERIVED FROM FACETS, NOT A SECOND TAXONOMY. The spec's section 3.3 proposed a
 * standalone 13-value enum. That enum cuts across FUNCTION, ACCESS and
 * APPLICATION inconsistently (INVASIVE_BCI_INTRACORTICAL is function + access,
 * DBS is function + access + application, SENSORY_PROSTHETICS is application
 * alone), so adopting it verbatim would have meant a second classifier that can
 * disagree with facets.js about the same item. Instead each subfield is a
 * predicate over the facet columns an item already carries. One classifier, one
 * source of truth, and a subfield can never contradict the facets it came from.
 *
 * WHAT THIS COSTS. Facets do not encode modality or substrate, so two of the
 * spec's subfields have no facet expression at all:
 *
 *   FOCUSED_ULTRASOUND    no modality facet. Focused ultrasound classifies as
 *                         `stimulates` + `non_invasive`, which is exactly what
 *                         TMS and tDCS classify as. Facets cannot separate them.
 *   INTERFACE_MATERIALS   no substrate facet. An electrode coating paper has no
 *                         function, access or application of its own.
 *
 * Both remain in the vocabulary with `derivable: false`. They can be set by hand
 * on a record but are never inferred from an item. Dropping them instead would
 * have discarded two real frontier axes (ultrasound spatial resolution, chronic
 * encapsulation) that the field measures and that Phase 2 needs somewhere to put.
 *
 * Stimulation for pain is the other known gap: facets cannot say whether a
 * `stimulates` + `pain` item is spinal cord, peripheral, or cranial nerve. Rather
 * than guess, `subfieldFor` returns null. Null is a supported outcome throughout
 * the pipeline (spec 7.1.3: an empty record set caps FD at 0 and the item ranks
 * on the leverage path), and it is measurable, which a wrong subfield is not.
 *
 * Treat this file as versioned data. PARTITION_VERSION is stamped onto every
 * record so a stored subfield never silently drifts when the rules change.
 */
import { isBCI, isClosedLoop } from './facets.js'

export const PARTITION_VERSION = 'sf-1.0'

const has = (arr, v) => Array.isArray(arr) && arr.includes(v)
const hasAny = (arr, vs) => vs.some(v => has(arr, v))

/**
 * Ordered, first match wins. Specific rules precede general ones, so a
 * closed-loop epilepsy device is not swallowed by the generic recording bucket.
 * `match` receives the three facet arrays; it must return true only when the
 * facets actually determine the subfield.
 */
export const SUBFIELDS = [
  // ── BCI, split by how the interface reaches the tissue ───────────────────
  // isBCI is records + decodes, the same derivation the badges use, so a
  // subfield can never disagree with the "BCI" badge shown on the card.
  {
    id: 'INVASIVE_BCI_INTRACORTICAL',
    label: 'Intracortical BCI',
    match: (fn, ax) => isBCI(fn) && has(ax, 'implanted_penetrating'),
  },
  {
    id: 'INVASIVE_BCI_ECOG',
    label: 'ECoG BCI',
    match: (fn, ax) => isBCI(fn) && has(ax, 'implanted_non_penetrating'),
  },
  {
    id: 'BCI_MINIMALLY_INVASIVE',
    label: 'Minimally invasive BCI',
    match: (fn, ax) => isBCI(fn) && has(ax, 'minimally_invasive'),
  },
  {
    id: 'BCI_NONINVASIVE',
    label: 'Non-invasive BCI',
    match: (fn, ax) => isBCI(fn) && has(ax, 'non_invasive'),
  },

  // ── Stimulation, ordered most specific first ─────────────────────────────
  // Closed-loop epilepsy precedes DBS: a responsive neurostimulator is both
  // implanted and stimulating, and the epilepsy indication is the distinguishing
  // fact. Checking it first is what keeps RNS out of the DBS bucket.
  {
    id: 'CLOSED_LOOP_EPILEPSY',
    label: 'Closed-loop epilepsy',
    match: (fn, ax, app) => isClosedLoop(fn) && has(app, 'epilepsy'),
  },
  {
    id: 'DBS',
    label: 'Deep brain stimulation',
    match: (fn, ax, app) => has(fn, 'stimulates') && has(ax, 'implanted_penetrating')
      && hasAny(app, ['movement_disorders', 'psychiatric']),
  },
  {
    id: 'SENSORY_PROSTHETICS',
    label: 'Sensory prosthetics',
    match: (fn, ax, app) => has(fn, 'stimulates') && has(app, 'sensory_restoration'),
  },
  {
    // Bypass and restoration is the part facets can see. Spinal cord stimulation
    // for pain is NOT captured here; see the pain gap in the file header.
    id: 'SPINAL_CORD_STIM_AND_BYPASS',
    label: 'Spinal cord stimulation and bypass',
    match: (fn, ax, app) => has(fn, 'stimulates') && has(app, 'movement_restoration')
      && hasAny(ax, ['implanted_penetrating', 'implanted_non_penetrating', 'minimally_invasive']),
  },
  {
    // Vagus, sacral, hypoglossal, and the rest of the organ-directed stimulators.
    // `autonomic_organ` is the facet that separates them from central targets.
    id: 'PERIPHERAL_CRANIAL_NERVE_STIM',
    label: 'Peripheral and cranial nerve stimulation',
    match: (fn, ax, app) => has(fn, 'stimulates') && has(app, 'autonomic_organ'),
  },

  // ── Algorithms and instrumentation ───────────────────────────────────────
  {
    // Decoding without recording: the item works on signals someone else
    // acquired, which is what makes it an algorithm rather than an interface.
    id: 'DECODING_ALGORITHMS',
    label: 'Decoding algorithms',
    match: fn => has(fn, 'decodes') && !has(fn, 'records'),
  },
  {
    // Acquisition hardware: images, or records without decoding anything.
    id: 'IMAGING_AND_RECORDING_HARDWARE',
    label: 'Imaging and recording hardware',
    match: fn => has(fn, 'images') || (has(fn, 'records') && !has(fn, 'decodes')),
  },

  // ── Present in the vocabulary, never derived ─────────────────────────────
  // Facets carry no modality or substrate axis. Assign these by hand on a record.
  {
    id: 'FOCUSED_ULTRASOUND',
    label: 'Focused ultrasound',
    derivable: false,
    match: () => false,
  },
  {
    id: 'INTERFACE_MATERIALS',
    label: 'Interface materials',
    derivable: false,
    match: () => false,
  },
]

export const SUBFIELD_IDS = SUBFIELDS.map(s => s.id)

export const SUBFIELD_LABEL = Object.fromEntries(SUBFIELDS.map(s => [s.id, s.label]))

/** Subfields a record may be assigned by hand but that are never inferred. */
export const MANUAL_ONLY_SUBFIELDS = SUBFIELDS.filter(s => s.derivable === false).map(s => s.id)

export const isSubfield = id => SUBFIELD_IDS.includes(id)

/**
 * The subfield implied by a row's stored facets, or null when the facets do not
 * determine one. Null is expected, not an error: an unclassified row, a row
 * outside the partition, and the stimulation-for-pain gap all land here. Callers
 * log the rate rather than substituting a guess.
 *
 * Reads the stored facet_* columns, so it never re-derives classification.
 */
export function subfieldFor(row) {
  if (!row) return null
  const fn = row.facet_function || []
  const ax = row.facet_access || []
  const app = row.facet_application || []
  if (!fn.length && !ax.length && !app.length) return null
  return SUBFIELDS.find(s => s.match(fn, ax, app))?.id ?? null
}
