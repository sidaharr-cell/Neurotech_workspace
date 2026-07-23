/**
 * mesh-map.js — MeSH subject headings → facets.
 *
 * MeSH headings are assigned to every PubMed record by trained NLM indexers,
 * which makes them the highest-quality classification signal available for the
 * papers table. 99.8% of papers carry a PubMed id.
 *
 * STATUS: seeded by hand with the headings we are confident about. Expand it
 * from the real frequency table once the backfill finishes:
 *   node --env-file=.env scripts/backfill-mesh.js --tally
 *   → docs/mesh-frequency.json  (headings ordered by how many papers carry them)
 *
 * Deliberately conservative: an unmapped heading yields "unknown", not "out of
 * scope", so classification falls through to keyword rules rather than
 * discarding a paper we simply haven't mapped yet.
 */

const F = (fn, ax = [], app = []) => ({ function: fn, access: ax, application: app })

/** Heading name (exact, as NLM writes it) → facets it implies. */
export const MESH_FACETS = {
  // ── Function: records ─────────────────────────────────────────────────────
  'Electroencephalography': F(['records'], ['non_invasive']),
  'Electrocorticography': F(['records'], ['implanted_non_penetrating']),
  'Electromyography': F(['records'], ['non_invasive']),
  'Evoked Potentials': F(['records'], ['non_invasive'], ['diagnostics']),
  'Evoked Potentials, Motor': F(['records'], ['non_invasive'], ['diagnostics']),
  'Evoked Potentials, Visual': F(['records'], ['non_invasive'], ['diagnostics']),
  'Evoked Potentials, Auditory': F(['records'], ['non_invasive'], ['diagnostics']),
  'Evoked Potentials, Somatosensory': F(['records'], ['non_invasive'], ['diagnostics']),
  'Electrodes, Implanted': F(['records'], ['implanted_non_penetrating']),
  'Microelectrodes': F(['records']),
  'Neurophysiological Monitoring': F(['records'], [], ['diagnostics']),
  'Polysomnography': F(['records'], ['non_invasive'], ['diagnostics']),
  'Neural Conduction': F(['records'], [], ['diagnostics']),
  'Action Potentials': F(['records']),

  // ── Function: stimulates ──────────────────────────────────────────────────
  'Deep Brain Stimulation': F(['stimulates'], ['implanted_penetrating']),
  'Transcranial Magnetic Stimulation': F(['stimulates'], ['non_invasive']),
  'Transcranial Direct Current Stimulation': F(['stimulates'], ['non_invasive']),
  'Vagus Nerve Stimulation': F(['stimulates']),
  'Spinal Cord Stimulation': F(['stimulates'], ['implanted_non_penetrating']),
  'Electric Stimulation Therapy': F(['stimulates']),
  'Transcutaneous Electric Nerve Stimulation': F(['stimulates'], ['non_invasive'], ['pain']),
  'Implantable Neurostimulators': F(['stimulates'], ['implanted_non_penetrating']),
  'Electroconvulsive Therapy': F(['stimulates'], ['non_invasive'], ['psychiatric']),
  'Electric Stimulation': F(['stimulates']),

  // ── Function: images ──────────────────────────────────────────────────────
  'Neuroimaging': F(['images'], ['non_invasive'], ['diagnostics']),
  'Functional Neuroimaging': F(['images'], ['non_invasive'], ['diagnostics']),
  'Magnetic Resonance Imaging': F(['images'], ['non_invasive'], ['diagnostics']),
  'Magnetoencephalography': F(['images', 'records'], ['non_invasive'], ['diagnostics']),
  'Spectroscopy, Near-Infrared': F(['images'], ['non_invasive']),
  'Positron-Emission Tomography': F(['images'], ['non_invasive'], ['diagnostics']),
  'Diffusion Tensor Imaging': F(['images'], ['non_invasive'], ['diagnostics']),

  // ── Function: decodes ─────────────────────────────────────────────────────
  'Brain-Computer Interfaces': F(['records', 'decodes']),
  'Neural Prostheses': F(['records', 'decodes']),
  'Man-Machine Systems': F(['decodes']),

  // ── Application ───────────────────────────────────────────────────────────
  'Cochlear Implants': F(['stimulates'], ['implanted_non_penetrating'], ['sensory_restoration']),
  'Cochlear Implantation': F(['stimulates'], ['implanted_non_penetrating'], ['sensory_restoration']),
  'Visual Prosthesis': F(['stimulates'], ['implanted_non_penetrating'], ['sensory_restoration']),
  'Hearing Aids': F([], ['non_invasive'], ['sensory_restoration']),
  'Auditory Brain Stem Implants': F(['stimulates'], ['implanted_non_penetrating'], ['sensory_restoration']),
  'Epilepsy': F([], [], ['epilepsy']),
  'Epilepsy, Temporal Lobe': F([], [], ['epilepsy']),
  'Drug Resistant Epilepsy': F([], [], ['epilepsy']),
  'Seizures': F([], [], ['epilepsy']),
  'Parkinson Disease': F([], [], ['movement_disorders']),
  'Essential Tremor': F([], [], ['movement_disorders']),
  'Dystonia': F([], [], ['movement_disorders']),
  'Tremor': F([], [], ['movement_disorders']),
  'Depressive Disorder, Major': F([], [], ['psychiatric']),
  'Depressive Disorder, Treatment-Resistant': F([], [], ['psychiatric']),
  'Obsessive-Compulsive Disorder': F([], [], ['psychiatric']),
  'Schizophrenia': F([], [], ['psychiatric']),
  'Spinal Cord Injuries': F([], [], ['movement_restoration']),
  'Quadriplegia': F([], [], ['movement_restoration']),
  'Paraplegia': F([], [], ['movement_restoration']),
  'Amyotrophic Lateral Sclerosis': F([], [], ['movement_restoration']),
  'Stroke': F([], [], ['rehabilitation']),
  'Stroke Rehabilitation': F([], [], ['rehabilitation']),
  'Neurological Rehabilitation': F([], [], ['rehabilitation']),
  'Chronic Pain': F([], [], ['pain']),
  'Neuralgia': F([], [], ['pain']),
  'Pain Management': F([], [], ['pain']),
  'Memory': F([], [], ['cognition_memory']),
  'Memory, Short-Term': F([], [], ['cognition_memory']),
  'Cognition': F([], [], ['cognition_memory']),
  'Alzheimer Disease': F([], [], ['cognition_memory']),
  'Urinary Incontinence': F([], [], ['autonomic_organ']),
  'Fecal Incontinence': F([], [], ['autonomic_organ']),
  'Gastroparesis': F([], [], ['autonomic_organ']),
  'Neurofeedback': F(['records'], ['non_invasive'], ['rehabilitation']),
  'Biofeedback, Psychology': F(['records'], ['non_invasive'], ['rehabilitation']),
  'Exoskeleton Device': F([], [], ['rehabilitation', 'movement_restoration']),
  'Speech': F([], [], ['communication_speech']),
  'Communication Aids for Disabled': F([], [], ['communication_speech']),

  // ── Added from the real frequency table (docs/mesh-frequency.json) ────────
  // Hearing dominates this corpus: cochlear implant work is ~10k papers.
  'Speech Perception': F([], [], ['sensory_restoration']),
  'Deafness': F([], [], ['sensory_restoration']),
  'Hearing Loss': F([], [], ['sensory_restoration']),
  'Hearing Loss, Sensorineural': F([], [], ['sensory_restoration']),
  'Hearing Loss, Bilateral': F([], [], ['sensory_restoration']),
  'Auditory Threshold': F([], [], ['sensory_restoration']),
  'Auditory Perception': F([], [], ['sensory_restoration']),
  'Correction of Hearing Impairment': F([], [], ['sensory_restoration']),
  'Persons With Hearing Impairments': F([], [], ['sensory_restoration']),
  'Cochlea': F([], [], ['sensory_restoration']),
  'Tinnitus': F([], [], ['sensory_restoration']),
  'Retinitis Pigmentosa': F([], [], ['sensory_restoration']),
  'Macular Degeneration': F([], [], ['sensory_restoration']),

  // Deep-brain-stimulation targets — these appear on DBS papers specifically.
  'Subthalamic Nucleus': F([], [], ['movement_disorders']),
  'Globus Pallidus': F([], [], ['movement_disorders']),
  'Levodopa': F([], [], ['movement_disorders']),
  'Antiparkinson Agents': F([], [], ['movement_disorders']),

  // Imaging
  'Brain Mapping': F(['images'], ['non_invasive']),
  'Tomography, X-Ray Computed': F(['images'], ['non_invasive'], ['diagnostics']),
  'Electroencephalography Phase Synchronization': F(['records'], ['non_invasive']),

  // Other applications
  'Pain': F([], [], ['pain']),
  'Pain Measurement': F([], [], ['pain']),
  'Pain, Postoperative': F([], [], ['pain']),
  'Epilepsies, Partial': F([], [], ['epilepsy']),
  'Anticonvulsants': F([], [], ['epilepsy']),
  'Stress Disorders, Post-Traumatic': F([], [], ['psychiatric']),
  'Tourette Syndrome': F([], [], ['psychiatric', 'movement_disorders']),
  'Multiple Sclerosis': F([], [], ['rehabilitation']),
  'Cerebral Palsy': F([], [], ['rehabilitation']),
  'Muscle Spasticity': F([], [], ['rehabilitation']),
  'Recovery of Function': F([], [], ['rehabilitation']),
  'Artificial Limbs': F([], [], ['movement_restoration']),
  'Hand Strength': F([], [], ['movement_restoration']),
  'Sleep Wake Disorders': F([], [], ['diagnostics']),
  'Wakefulness': F([], [], ['diagnostics']),
}

/**
 * Headings that mark a paper as basic science with no device or interface
 * intent. Only applied when NOTHING in MESH_FACETS matched, so a genuine
 * neurotech paper that also uses optogenetics is not thrown away.
 */
const OUT_OF_SCOPE_HEADINGS = new Set([
  // Molecular and cellular neuroscience
  'Optogenetics', 'Molecular Biology', 'Gene Expression Regulation', 'Signal Transduction',
  'Cells, Cultured', 'Protein Binding', 'Biosensing Techniques', 'Molecular Sequence Data',
  'Recombinant Proteins', 'Neurons', 'Synapses', 'Synaptic Transmission', 'Interneurons',
  'Patch-Clamp Techniques', 'Calcium Signaling', 'Nerve Net', 'Neuronal Plasticity',
  'Neural Inhibition', 'Models, Neurological', 'Receptors, Neurotransmitter',
  // Animal models — a device paper still stays in, because these are only
  // consulted when NOTHING in MESH_FACETS matched.
  'Mice', 'Rats', 'Mice, Transgenic', 'Mice, Knockout', 'Mice, Inbred C57BL',
  'Rats, Sprague-Dawley', 'Rats, Wistar', 'Rats, Long-Evans', 'Cats', 'Macaca mulatta',
  'Disease Models, Animal', 'Behavior, Animal', 'Caenorhabditis elegans', 'Drosophila',
  'Zebrafish', 'Xenopus',
])

const names = mesh => (mesh || []).map(m => (typeof m === 'string' ? m : m?.name)).filter(Boolean)

/** Facets implied by a paper's MeSH headings, or null if none are mapped. */
export function meshFacets(mesh) {
  const hits = names(mesh).map(n => MESH_FACETS[n]).filter(Boolean)
  if (!hits.length) return null
  return {
    function: [...new Set(hits.flatMap(h => h.function))],
    access: [...new Set(hits.flatMap(h => h.access))],
    application: [...new Set(hits.flatMap(h => h.application))],
  }
}

/**
 * true  — a mapped neurotech heading is present
 * false — no mapped heading, and the paper looks like basic science
 * null  — unknown; the caller should fall through to keyword rules
 */
export function isMeshInScope(mesh) {
  const ns = names(mesh)
  if (!ns.length) return null
  if (ns.some(n => MESH_FACETS[n])) return true
  if (ns.some(n => OUT_OF_SCOPE_HEADINGS.has(n))) return false
  return null
}

export const MESH_MAPPED_COUNT = Object.keys(MESH_FACETS).length
