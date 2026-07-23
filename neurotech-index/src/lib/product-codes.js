/**
 * product-codes.js — the curated FDA product-code decision table.
 *
 * Every device in the index carries an FDA product code (186 distinct values,
 * 100% coverage). The code is the regulator's own classification, so it drives
 * both scope and facets instead of guessing from the device's trade name.
 *
 * Reviewed by hand against the official FDA device name for each code
 * (see docs/product-code-map.json for the source data). Codes absent from this
 * table are treated as OUT of scope — new codes must be reviewed before they
 * can appear on the site.
 *
 * Shorthand:
 *   fn  r=records  s=stimulates  i=images  d=decodes
 *   ax  n=non_invasive  m=minimally_invasive  s=implanted_surface  p=penetrating
 */

export const FN = { r: 'records', s: 'stimulates', i: 'images', d: 'decodes' }
export const AX = { n: 'non_invasive', m: 'minimally_invasive', s: 'implanted_non_penetrating', p: 'implanted_penetrating' }

// code: [fn, ax, [applications]]
const IN_SCOPE = {
  // ── Non-invasive stimulation ──────────────────────────────────────────────
  GZJ: ['s', 'n', ['pain']],                                  // TENS for pain relief (603)
  NUH: ['s', 'n', ['pain', 'consumer_wellness']],             // TENS over-the-counter (224)
  LIH: ['s', 'n', ['pain']],                                  // Interferential current therapy (73)
  NFO: ['s', 'n', ['consumer_wellness']],                     // TENS, aesthetic purposes (78)
  GZI: ['s', 'n', ['rehabilitation', 'movement_restoration']], // External functional neuromuscular stim (60)
  OBP: ['s', 'n', ['psychiatric']],                           // Transcranial magnetic stimulator (58)
  QJQ: ['s', 'n', ['psychiatric']],                           // Cranial electrotherapy, insomnia/anxiety (19)
  PCC: ['s', 'n', ['pain']],                                  // TENS for migraine (17)
  QGH: ['s', 'n', ['psychiatric']],                           // Electroconvulsive therapy (9)
  QBC: ['s', 'n', ['movement_disorders']],                    // External upper-limb tremor stimulator (9)
  QCI: ['s', 'n', ['psychiatric']],                           // TMS for OCD (9)
  NYN: ['s', 'n', ['pain']],                                  // TENS for arthritis (8)
  PKR: ['s', 'n', ['pain']],                                  // Non-invasive vagus nerve stim, headache (7)
  QGT: ['s', 'n', ['pain']],                                  // Distal transcutaneous stimulator (7)
  OKP: ['s', 'n', ['pain']],                                  // TMS for migraine (6)
  QPL: ['s', 'n', ['pain']],                                  // Electromagnetic stimulator, pain (6)
  QGL: ['s', 'n', ['psychiatric']],                           // Transcutaneous nerve stim for ADHD (5)
  JXK: ['s', 'n', ['psychiatric']],                           // Cranial electrotherapy, depression (2)
  QCF: ['s', 'n', ['rehabilitation']],                        // Electrical tongue stimulator, motor deficits (2)
  QMD: ['s', 'n', ['psychiatric']],                           // TMS for smoking cessation (2)
  OCF: ['s', 'n', ['pain']],                                  // TENS limited output, arthritis (1)
  QAR: ['s', 'n', ['pain']],                                  // Thermal vestibular stimulator, headache (1)
  QSQ: ['s', 'n', ['pain']],                                  // TENS for fibromyalgia (1)
  QWD: ['s', 'n', ['movement_disorders']],                    // Nerve stim, restless legs (1)
  SHX: ['s', 'n', ['psychiatric']],                           // Transcranial nerve stim, post-traumatic (1)
  SIG: ['s', 'n', ['psychiatric']],                           // TMS for PTSD (1)
  QFF: ['s', 'n', ['psychiatric']],                           // Robotic arm for a TMS system (1)
  SGE: ['s', 'n', ['psychiatric']],                           // Positioning system for a TMS system (1)

  // ── Percutaneous / minimally invasive stimulation ─────────────────────────
  NHI: ['s', 'm', ['pain']],                                  // Percutaneous nerve stim (PENS), pain (11)
  PZR: ['s', 'm', ['psychiatric']],                           // Percutaneous nerve stim, opioid withdrawal (8)
  SCN: ['s', 'm', ['pain']],                                  // Temporarily implanted peripheral nerve stim (1)

  // ── Implanted stimulation ─────────────────────────────────────────────────
  GZB: ['s', 's', ['pain']],                                  // Spinal cord stimulator, implanted (137)
  GZF: ['s', 's', ['pain']],                                  // Peripheral nerve stimulator, implanted (24)
  GZE: ['s', 's', ['autonomic_organ']],                       // Implanted diaphragmatic/phrenic stim (10)
  GZC: ['s', 's', ['rehabilitation']],                        // Neuromuscular stimulator, implanted (6)
  LHG: ['sr', 's', ['pain']],                                 // Spinal epidural electrode (1)

  // ── Evoked-response systems (stimulate AND record) ────────────────────────
  GWF: ['sr', 'n', ['diagnostics']],                          // Electrical evoked response stimulator (139)
  GWJ: ['sr', 'n', ['diagnostics', 'sensory_restoration']],   // Auditory evoked response stimulator (75)
  GWE: ['sr', 'n', ['diagnostics']],                          // Photic evoked response stimulator (49)
  NTU: ['sr', 'n', ['diagnostics']],                          // Thermal evoked potential stimulator (3)
  GZP: ['sr', 'n', ['diagnostics']],                          // Mechanical evoked response stimulator (2)
  SFN: ['sr', 'n', ['diagnostics']],                          // Non-invasive evoked response brain stimulator (1)
  SDX: ['sr', 'n', ['rehabilitation']],                       // Neuromuscular stim + exercise evaluation (1)

  // ── Non-invasive recording: EEG systems and software ──────────────────────
  GWQ: ['r', 'n', ['diagnostics']],                           // Full-montage standard EEG (189)
  OLV: ['r', 'n', ['diagnostics']],                           // Standard polysomnograph with EEG (64)
  OLT: ['r', 'n', ['diagnostics']],                           // Non-normalizing qEEG software (54)
  OMB: ['r', 'n', ['epilepsy', 'diagnostics']],               // Automatic event detection, EEG (41)
  OLW: ['r', 'n', ['diagnostics']],                           // Index-generating EEG software (38)
  OLZ: ['r', 'n', ['diagnostics']],                           // Automatic event detection, polysomnograph (36)
  OMC: ['r', 'n', ['diagnostics']],                           // Reduced-montage standard EEG (29)
  OLX: ['ri', 'n', ['diagnostics']],                          // Source localization software, EEG/MEG (24)
  OMA: ['r', 'n', ['diagnostics']],                           // Amplitude-integrated EEG (16)
  OLU: ['r', 'n', ['diagnostics']],                           // Normalizing qEEG software (13)
  PIW: ['r', 'n', ['diagnostics']],                           // Brain injury interpretive EEG aid (9)
  POS: ['r', 'n', ['epilepsy']],                              // Physiological signal seizure monitoring (9)
  GYA: ['r', 'n', ['diagnostics']],                           // EEG electrode/lead tester (5)
  NCG: ['r', 'n', ['psychiatric', 'diagnostics']],            // Neuropsychiatric interpretive EEG aid (3)
  ORT: ['r', 'n', ['diagnostics']],                           // Burst suppression detection software (1)
  GYE: ['r', 'n', ['epilepsy', 'diagnostics']],               // Encephalogram telemetry system (20)
  GWS: ['r', 'n', ['diagnostics']],                           // EEG signal spectrum analyzer (15)

  // ── Electrodes and front-end hardware ─────────────────────────────────────
  GXY: ['r', 'n', ['diagnostics']],                           // Cutaneous electrode (434)
  GXZ: ['r', 'm', ['diagnostics']],                           // Needle electrode (53)
  GWL: ['r', 'n', ['diagnostics']],                           // Physiological signal amplifier (53)
  GWK: ['r', 'n', ['diagnostics']],                           // Physiological signal conditioner (23)
  GZK: ['r', 'm', ['diagnostics']],                           // Nasopharyngeal electrode (2)
  GZL: ['r', 'p', ['epilepsy', 'diagnostics']],               // Depth electrode — sEEG (58)
  GYC: ['r', 's', ['epilepsy', 'diagnostics']],               // Cortical electrode — subdural (32)
  JXI: ['rs', 's', ['diagnostics']],                          // Nerve cuff (39)
  SEM: ['r', 's', ['epilepsy']],                              // Sub-scalp implanted EEG system (2)

  // ── Other recording / physiological measurement ───────────────────────────
  HCC: ['r', 'n', ['rehabilitation']],                        // Biofeedback device (172)
  GWM: ['r', 'p', ['diagnostics']],                           // Intracranial pressure monitoring (105)
  GWN: ['r', 'n', ['diagnostics']],                           // Nystagmograph (59)
  JXE: ['r', 'n', ['diagnostics']],                           // Nerve conduction velocity measurement (27)
  GZO: ['r', 'n', ['autonomic_organ', 'diagnostics']],        // Galvanic skin response measurement (26)
  LEL: ['r', 'n', ['diagnostics']],                           // Sleep assessment device (19)
  GYD: ['r', 'n', ['movement_disorders', 'diagnostics']],     // Tremor transducer (13)
  HCJ: ['r', 'n', ['autonomic_organ']],                       // Skin potential measurement (2)
  SEN: ['r', 'n', ['rehabilitation']],                        // Biofeedback, adjunctive treatment (1)
  SFK: ['r', 'n', ['diagnostics']],                           // Respiratory effort belt, polysomnography (1)

  // ── Imaging ───────────────────────────────────────────────────────────────
  OLY: ['ir', 'n', ['diagnostics']],                          // Magnetoencephalograph (6)
  GXW: ['i', 'n', ['diagnostics']],                           // Echoencephalograph (7)

  // ── Brain-computer interface ──────────────────────────────────────────────
  QOL: ['rd', 'n', ['rehabilitation', 'movement_restoration']], // EEG-driven powered upper-limb exerciser (1)

  // ── Planning / programming software for neurodevices ──────────────────────
  QQC: ['', '', ['movement_disorders']],                      // Brain stimulation programming software (3)
}

/**
 * Codes considered and deliberately EXCLUDED, with the reason recorded so the
 * decision is auditable and a future owner can revisit it.
 *
 * Three principles decided these, and they generalise to codes we haven't seen
 * yet — apply them before adding anything to IN_SCOPE:
 *
 *   1. Ablation is not modulation. Destroying neural tissue is not "delivering
 *      energy to modulate neural activity" — it is neurosurgery. Devices whose
 *      purpose is to lesion a nerve are out.
 *   2. Instrumented measurement is in; patient-reported thresholds are out.
 *      A nerve conduction study reads an electrical response from the body (in).
 *      An esthesiometer applies a filament and asks the patient what they felt —
 *      the instrument never touches a neural signal (out).
 *   3. Software with no neural signal is out. A cognitive test delivered on a
 *      screen measures behaviour, not the nervous system. This keeps us
 *      consistent with the computerized behavioural-therapy codes already out.
 */
export const EXCLUDED = {
  // Principle 1 — ablative, not modulatory
  GXI: 'Probe, Radiofrequency Lesion (65) — lesions the nerve rather than modulating it',
  GXD: 'Generator, Lesion, Radiofrequency (37) — same',
  SGN: 'HIFU System For Peripheral Neural Tissue (1) — ablative',
  // Principle 2 — no instrumented neural measurement
  GXB: 'Esthesiometer (7) — calibrated filament; the reading is the patient\'s report',
  LLN: 'Device, Vibration Threshold Measurement (13) — patient-reported threshold',
  LQW: 'Test, Temperature Discrimination (3) — patient-reported threshold',
  GWI: 'Discriminator, Two-Point (2) — a caliper',
  // Principle 3 — software, no neural signal
  POM: 'Computerized Cognitive Assessment Aid For Concussion (8) — behavioural test',
  QEA: 'Oculomotor Assessment Aid (7) — behavioural test',
  // Trivial consumer device, target is skin sensation rather than the nervous system
  OSG: 'Piezo-Electric Stimulator, Mosquito Bite Itch (2)',
}

// ── Lookup ──────────────────────────────────────────────────────────────────

const expand = (letters, table) => [...(letters || '')].map(c => table[c]).filter(Boolean)

/** Facets for an FDA product code, or null when the code is out of scope. */
export function facetsForProductCode(code) {
  const row = IN_SCOPE[String(code || '').toUpperCase()]
  if (!row) return null
  const [fn, ax, app] = row
  const fns = expand(fn, FN), axs = expand(ax, AX)
  return {
    // In scope but does nothing to the nervous system itself (planning software)
    // takes the explicit exclusive values rather than an empty list.
    function: fns.length ? fns : ['none'],
    access: axs.length ? axs : ['not_applicable'],
    application: app || [],
  }
}

export const isProductCodeInScope = code => Boolean(IN_SCOPE[String(code || '').toUpperCase()])

/** Pull the product code out of a device row (ingest stores it in description). */
export const productCodeOf = device =>
  (/product code ([A-Z]{3})/.exec(device?.description || '') || [])[1] || null

export const IN_SCOPE_CODES = Object.keys(IN_SCOPE)
