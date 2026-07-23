# NeuroBase Classification System — full category and keyword reference

Version 1.0 · 23 July 2026 · replaces the eight-class Device Class scheme in
`src/lib/taxonomy.js`.

This is the complete specification: every facet, every category, and every
keyword. It contains no machine-learning components — classification is
deterministic, so the same input always produces the same output.

**Companion file:** `docs/product-code-map.json` — all 186 FDA product codes
present in the devices table, resolved to their official FDA classification
with draft facet assignments.

---

## Part 1 — The three facets

Each item is answered on three independent questions. All three are
multi-valued: an item may carry more than one value on any facet. Overlap
*within* a facet is meaningful, not a defect.

### FACET 1 — FUNCTION: what it does to the nervous system

| Value | Meaning |
|---|---|
| `records` | Senses or measures neural or neuromuscular activity |
| `stimulates` | Delivers energy to modulate neural activity |
| `images` | Produces a spatial map of structure or activity |
| `decodes` | Converts recorded activity into an inference, command or control signal |
| `none` | In scope but does none of these (a company profile, a policy paper). **Exclusive** — never combined |

### FACET 2 — ACCESS: how invasive it is

| Value | Meaning |
|---|---|
| `non_invasive` | Nothing breaches the skin |
| `minimally_invasive` | Percutaneous or endovascular; no open surgery |
| `implanted_non_penetrating` | Surgically placed, sits on a surface |
| `implanted_penetrating` | Enters neural tissue |
| `not_applicable` | Access is not a property of this item. **Exclusive** |

### FACET 3 — APPLICATION: what problem it addresses

`movement_restoration` · `communication_speech` · `sensory_restoration` ·
`epilepsy` · `movement_disorders` · `psychiatric` · `pain` ·
`cognition_memory` · `autonomic_organ` · `rehabilitation` · `diagnostics` ·
`research_tool` · `consumer_wellness`

### Derived badges — computed, never stored as categories

- **BCI** = `records` + `decodes`
- **Closed-loop** = `records` + `stimulates`

---

## Part 2 — Precedence: which source wins

For every item, apply the highest-priority source that produces a result. Only
fall through when the source above is absent.

1. **Curated vocabulary** — MeSH terms, CPC codes, FDA product codes, trial
   condition/intervention fields. Assigned by expert indexers; authoritative.
2. **Keyword rules** — applied to named content fields only, matching whole
   words. Used when no code exists.
3. **Roll-up** — labs and researchers inherit from the papers and patents they
   produced.
4. **Abstain** — write `unclassified` rather than guess. An honest blank beats
   a wrong category.

### Matching rules for all keywords

- Search **named content fields only** — title, abstract, name, description,
  summary. Never author names, journals, URLs, IDs or the whole record.
- **Stems** match at a word start and may carry any suffix:
  `electrophysiolog` catches "electrophysiological", `ecog` never catches
  "recognition".
- **Words** match as whole words with no suffix — used for short, ambiguous
  tokens (`fes`, `meg`, `pet`) that otherwise match inside unrelated words.
- **Phrases** match as bounded phrases.
- All matching is case-insensitive.

---

## Part 3 — Keywords by facet

### FUNCTION → `records`

**Stems:** eeg · ecog · electroencephalograph · electrocorticograph ·
electrophysiolog · electromyograph · intracortical · microelectrode ·
electrocortical · neurograph · polysomnograph

**Words:** lfp · lfps · emg · eng · erp · meg

**Phrases:** single-unit · multi-unit · neural recording · neural signal
acquisition · microelectrode array · utah array · recording array · local field
potential · evoked potential · evoked response · spike sorting · depth
electrode · subdural electrode · nerve conduction · action potential recording ·
unit activity · neural telemetry

### FUNCTION → `stimulates`

**Stems:** neurostimulat · neuromodulat · transcranial · stimulator ·
microstimulat · magnetotherap · electroceutic

**Words:** dbs · tms · rtms · tdcs · tacs · tens · vns · scs · fes

**Phrases:** deep brain stimulation · spinal cord stimulation · vagus nerve
stimulation · vagal nerve stimulation · sacral nerve stimulation · peripheral
nerve stimulation · phrenic nerve pacing · diaphragmatic pacing · functional
electrical stimulation · transcutaneous electrical nerve · transcutaneous
direct current · direct current stimulation · alternating current stimulation ·
magnetic stimulation · epidural stimulation · cortical stimulation ·
intracortical microstimulation · optogenetic stimulation · focused ultrasound
neuromodulation · responsive stimulation · electrical stimulation therapy

### FUNCTION → `images`

**Stems:** fmri · fnirs · magnetoencephalograph · neuroimaging · tomograph ·
elastograph

**Words:** meg · pet · mri · dti

**Phrases:** functional near-infrared · near-infrared spectroscopy · calcium
imaging · two-photon · functional imaging · functional neuroimaging ·
functional ultrasound · diffusion tensor · positron emission · magnetic
resonance imaging · optical imaging of neural

### FUNCTION → `decodes`

**Stems:** decod

**Words:** bci · bcis · bmi

**Phrases:** brain-computer · brain computer · brain-machine · brain machine ·
neural interface · neural decoding · neural decoder · speech decoding · motor
decoding · intention decoding · movement intention · neural control · neural
bypass · braingate · neuralink · stentrode · cursor control · neural
classifier · myoelectric control

---

### ACCESS → `non_invasive`

**Stems:** transcranial · transcutaneous · scalp · wearable · headband ·
headset · noninvasive

**Words:** eeg · tms · rtms · tdcs · tacs · tens · fnirs · meg

**Phrases:** non-invasive · surface electrode · dry electrode · surface emg ·
skin electrode · over-the-counter · external stimulator

### ACCESS → `minimally_invasive`

**Stems:** endovascular · percutaneous

**Phrases:** minimally invasive · stentrode · injectable electrode ·
catheter-delivered · stent-mounted · burr-hole only

### ACCESS → `implanted_non_penetrating`

**Stems:** ecog · electrocorticograph · subdural · epidural · epiretinal ·
implantable · implanted

**Phrases:** nerve cuff · cuff electrode · surface array · cortical surface ·
cochlear implant · implanted stimulator · subdural grid · subdural strip

### ACCESS → `implanted_penetrating`

**Stems:** intracortical · penetrating · microwire

**Words:** seeg

**Phrases:** utah array · depth electrode · stereo-eeg · stereoelectroencephalography ·
thread electrode · michigan probe · neural probe · penetrating array · dbs lead ·
intraparenchymal · neuralink

---

### APPLICATION keywords

**`movement_restoration`** — paralysis · tetrapleg · quadripleg · hemipleg ·
spinal cord injury · reach and grasp · prosthetic limb · robotic arm · motor
restoration · locomotor recovery · restoring movement · limb prosthesis

**`communication_speech`** — speech decoding · speech neuroprosthes ·
communication bci · spelling interface · handwriting decoding · locked-in ·
anarthria · augmentative communication · silent speech

**`sensory_restoration`** — cochlear implant · auditory brainstem · hearing
restoration · hearing loss · hearing preservation · bionic eye · retinal
implant · retinal prosthes · visual prosthes · artificial vision · sensory
feedback · tactile feedback · somatosensory restoration · sensory substitution

**`epilepsy`** — epilep · seizure · anticonvuls · responsive neurostim ·
refractory epilepsy · ictal · interictal

**`movement_disorders`** — parkinson · essential tremor · dystonia ·
huntington · bradykinesia · dyskinesia · deep brain stimulation for tremor

**`psychiatric`** — depress · obsessive-compulsive · ocd · ptsd · anxiety
disorder · schizophren · addiction · substance use disorder · psychiatric
neurosurgery · electroconvulsive

**`pain`** — chronic pain · pain relief · analges · neuropathic pain ·
failed back surgery · complex regional pain · nocicept · migraine

**`cognition_memory`** — cognitive prosthes · memory prosthes · hippocampal
prosthes · memory enhancement · memory restoration · working memory ·
cognitive enhancement · cognitive training · cognitive rehabilitation ·
attention monitoring · alzheimer · dementia · mild cognitive impairment

**`autonomic_organ`** — gastroparesis · incontinence · bladder control ·
sacral neuromodulation · diaphragmatic pacing · phrenic nerve · vagus nerve
stimulation for · heart rate variability · autonomic dysfunction ·
sudomotor · gastric electrical stimulation · dyspepsia

**`rehabilitation`** — rehabilit · physiotherap · neurorehabilit · gait
training · stroke recovery · motor relearning · biofeedback · exoskeleton ·
functional electrical stimulation therapy · upper limb training

**`diagnostics`** — diagnos · nerve conduction study · evoked potential
testing · intraoperative monitoring · intracranial pressure monitoring ·
polysomnograph · screening · electrodiagnostic · brain death determination

**`research_tool`** — research use only · preclinical · animal model ·
in vivo recording · laboratory instrument · optogenetic tool · calcium
indicator · head-fixed · rodent · non-human primate

**`consumer_wellness`** — consumer eeg · meditation · focus training ·
sleep tracking · wellness · neurofeedback headband · over-the-counter
stimulator · direct-to-consumer

---

## Part 4 — Vocabulary mappings by content type

### Papers (83,772 rows · 99.8% have a PubMed ID)

**Primary source: MeSH terms.** Every PubMed record carries subject headings
assigned by trained NLM indexers. These are not currently fetched. Add MeSH
retrieval to `backfill-pubmed.js` (the `MeshHeadingList` element of the same
efetch XML already being parsed) and store as a `mesh` column.

*Resolve exact descriptor IDs from the NLM MeSH browser at build time; the
heading names below are stable, the IDs should not be transcribed by hand.*

- **→ `records`:** Electroencephalography · Electrocorticography ·
  Electromyography · Evoked Potentials · Magnetoencephalography ·
  Electrodes, Implanted · Neurophysiological Monitoring
- **→ `stimulates`:** Deep Brain Stimulation · Transcranial Magnetic
  Stimulation · Transcranial Direct Current Stimulation · Vagus Nerve
  Stimulation · Spinal Cord Stimulation · Electric Stimulation Therapy ·
  Transcutaneous Electric Nerve Stimulation · Implantable Neurostimulators ·
  Optogenetics
- **→ `images`:** Neuroimaging · Functional Neuroimaging · Magnetic Resonance
  Imaging · Spectroscopy, Near-Infrared · Positron-Emission Tomography ·
  Diffusion Tensor Imaging
- **→ `decodes`:** Brain-Computer Interfaces · Neural Prostheses
- **→ `sensory_restoration`:** Cochlear Implants · Cochlear Implantation ·
  Visual Prosthesis · Hearing Aids
- **→ `epilepsy`:** Epilepsy · Seizures · Drug Resistant Epilepsy
- **→ `movement_disorders`:** Parkinson Disease · Essential Tremor · Dystonia
- **→ `psychiatric`:** Depressive Disorder, Major · Obsessive-Compulsive
  Disorder · Schizophrenia
- **→ `movement_restoration`:** Spinal Cord Injuries · Quadriplegia ·
  Paraplegia · Amyotrophic Lateral Sclerosis · Stroke
- **→ `pain`:** Chronic Pain · Neuralgia · Pain Management
- **→ `cognition_memory`:** Memory · Cognition · Alzheimer Disease

**Fallback:** keyword rules over title + abstract (94.9% have an abstract).

### Patents (47,360 rows · 92.1% have CPC codes · only 7.8% have an abstract)

**Primary source: CPC codes** — text matching cannot work here, because more
than nine in ten patents have no abstract to match against.

- `A61N1/05`, `A61N1/36`, `A61N1/372`, `A61N1/375`, `A61N1/378` → `stimulates`
- `A61N2/00` → `stimulates` + `non_invasive`
- `A61B5/369`, `A61B5/377`, `A61B5/378`, `A61B5/388`, `A61B5/389`,
  `A61B5/291`, `A61B5/293` → `records`
- `A61B5/372` → `images`
- `G06F3/015` → `decodes` + `records`
- `A61F2/72` → `records` + `movement_restoration`
- `A61N1/05` additionally → `implanted_non_penetrating`
- `A61N1/36008` (cochlear/auditory subgroups) → `sensory_restoration`

**Fallback:** keyword rules over title, plus abstract where present.

### Devices (6,008 rows · 100% have an FDA product code · 186 distinct codes)

**Primary and only source: the FDA product code.** See
`docs/product-code-map.json` for all 186 resolved codes with official device
names and draft facet assignments. Confirm each once; thereafter it is
authoritative and never needs revisiting.

Representative rows, by device count:

- `GZJ` (603) — Stimulator, Nerve, Transcutaneous, For Pain Relief → **in
  scope**, `stimulates` + `non_invasive` + `pain`
- `NUH` (224) — Stimulator, Nerve, Transcutaneous, Over-The-Counter → **in
  scope**, `stimulates` + `non_invasive` + `consumer_wellness`
- `GWQ` (189) — Full-Montage Standard Electroencephalograph → **in scope**,
  `records` + `non_invasive` + `diagnostics`
- `GWF` (139) — Stimulator, Electrical, Evoked Response → **in scope**,
  `stimulates` + `records` + `diagnostics`
- `GZB` (137) — Stimulator, Spinal-Cord, Implanted (Pain Relief) → **in
  scope**, `stimulates` + `implanted_non_penetrating` + `pain`
- `HAW` (415) — Neurological Stereotaxic Instrument → **out of scope**
- `OLO` (407) — Orthopedic Stereotaxic Instrument → **out of scope**
- `JXG` (258) — Shunt, Central Nervous System → **out of scope**
- `HCG` (176) — Device, Neurovascular Embolization → **out of scope**
- `GYB` (67) — Media, Electroconductive → **out of scope**

**Status: reviewed and settled.** All 186 codes have been decided by hand
against their official FDA names. 83 codes are in scope, covering 3,384 devices
(56% of the table). The curated decisions live in `src/lib/product-codes.js`,
which is the source of truth — `product-code-map.json` is only the raw FDA data
it was built from.

### Three principles for deciding a product code

Apply these before adding any new code. They decided the ten genuinely
ambiguous cases and they generalise, so future codes should not need fresh
argument.

1. **Ablation is not modulation.** Destroying neural tissue is not "delivering
   energy to modulate neural activity" — it is neurosurgery. Radiofrequency
   lesion probes and generators, and focused-ultrasound ablation of nerve, are
   **out**.
2. **Instrumented measurement is in; patient-reported thresholds are out.** A
   nerve conduction study reads an electrical response from the body, so it is
   in. An esthesiometer applies a filament and asks the patient what they felt —
   the instrument never touches a neural signal, so it is out. This is the line
   between `JXE` (nerve conduction, in) and `GXB` (esthesiometer, out).
3. **Software with no neural signal is out.** A cognitive or oculomotor test
   delivered on a screen measures behaviour, not the nervous system. This keeps
   the decision consistent with the computerized behavioural-therapy codes,
   which were already out.

All ten reviewed exclusions are recorded with reasons in the `EXCLUDED` map, so
the decision is auditable rather than silent.

### Clinical trials (8,329 rows · structured fields on every row)

**Primary source: the `conditions` and `interventions` arrays** already stored
in `metadata` and currently unused.

- `interventions` containing "Device:" → the device name feeds FUNCTION and
  ACCESS keyword rules
- `interventions` containing "Drug:" or "Biological:" only, with no device →
  **out of scope**
- `conditions` map directly to APPLICATION using the MeSH condition mappings
  above (ClinicalTrials.gov condition terms are MeSH-aligned)

**Fallback:** keyword rules over title + brief summary.

### News (165 rows)

Keyword rules over headline + summary. No vocabulary exists and none is needed
at this volume. **Fix required:** write real facet values into `topics`, which
currently holds free text like "BCI" and "Motor cortex" — this is why
server-side filtering returns nothing for news.

### Labs (1,796 rows) and researchers (12 rows)

**Roll-up, in this order:**

1. **From publications.** `organizations.founders[0]` holds the principal
   investigator's full name in the same format as the `papers.authors` array
   (e.g. "Krishna V Shenoy"), so a direct string join works. Take the union of
   the facets of that person's papers, keeping any facet appearing in ≥15% of
   their output to suppress one-off collaborations.
2. **From NIH RePORTER project text.** `backfill-labs.js` already queries
   RePORTER but stores only a single arbitrary project title. Re-pull and store
   the union of all project titles plus the `terms` field, then apply keyword
   rules. This is why Shenoy's lab is currently unclassifiable — its stored
   description reads "Focus: Data Science Core."
3. **Abstain** if neither yields a result.

**Fix required:** `organizations.focus_areas` and `researchers.expertise` hold
free text and must be written with real facet values.

---

## Part 5 — Storage and reproducibility

Classification runs **once, at import**, and writes to indexed columns:

```
facet_function     text[]   -- e.g. {records,decodes}
facet_access       text[]   -- e.g. {implanted_penetrating}
facet_application  text[]   -- e.g. {movement_restoration}
in_scope           boolean
classifier_version text     -- e.g. 'v1.0'
```

Every page — feed, search, section pages, directory rails — reads these
columns. Nothing is recomputed in the browser. This guarantees three things:

- **Identical results on every page.** The current split between two
  classifiers disappears.
- **Permanent reproducibility.** A stored value cannot drift. Re-running only
  happens on a deliberate `classifier_version` bump.
- **Fast filtering.** A GIN index on each column replaces scanning JSON on
  every keystroke.
