# NeuroBase classification rubric v2

The labeling standard for the gold set. Every number in the taxonomy report
inherits its definition from this file. Scope decisions were made by the site
owner on 2026-07-22.

Each item is labeled on four independent questions. Answer them in order — an
out-of-scope item still gets the remaining fields filled as `none` /
`not_applicable` so the scorer can distinguish "not neurotech" from
"neurotech we failed to classify".

> **Changes from v1.** Added `decodes` to Function (v1 discarded the single most
> distinctive BCI capability). Made Access multi-valued (v1's "pick the most
> invasive" rule erased the non-invasive half of comparative work). Added
> `neuromuscular` to Target and a precedence rule for cranial nerves. Added a
> required reason category for out-of-scope items.

---

## 1. Scope — does this belong in NeuroBase at all?

**IN SCOPE.** Any technology, study, organization, or invention whose purpose
involves recording, stimulating, imaging, or decoding the activity of the
nervous system — central or peripheral. This explicitly includes:

- **Peripheral and autonomic neuromodulation**, even when the therapeutic
  target is a non-neural organ. Vagus nerve stimulation for dyspepsia, sacral
  nerve stimulation for incontinence, and phrenic/diaphragmatic pacing are all
  IN. The intervention acts on a nerve; that is sufficient.
- **Rehabilitation, EMG, and biofeedback systems**, including those that do not
  decode a neural signal. Functional electrical stimulation therapy,
  EMG-triggered rehab devices, exoskeletons, and evoked-potential or EMG
  measuring systems are IN.
- Devices, the algorithms that interpret their signals, the clinical studies
  that test them, the labs and companies that build them, and the patents that
  claim them.

**OUT OF SCOPE.**

- **Basic neuroscience methods with no device or interface intent** — optogenetics
  used to interrogate a molecular pathway, calcium imaging in mice, molecular or
  cellular neuroscience, animal electrophysiology run purely as a research
  readout. The distinguishing question is whether the work is building or testing
  a *neurotechnology*, not whether it uses a technique on neural tissue.
- **Drug and biologic trials** with no neurotechnology component, even in
  neurological disease.
- **Neurosurgical hardware and consumables** — dura substitutes, cranial molding
  helmets, embolic coils, surgical navigation instruments, conductive gel,
  electrode paste, cranial fixation.
- Anything unrelated to the nervous system.

**Boundary cases, resolved.** Optogenetics *as the stimulation modality of a
neural interface* is IN; optogenetics as a cell-biology tool is OUT. An EEG
electrode is IN; the gel you stick it on is OUT. A trial of a drug delivered
*by* an implanted neural device is IN; a drug trial in epilepsy is OUT.

When genuinely uncertain, mark `in_scope` by your best judgment and set
`confidence` to `low` — the scorer reports low-confidence items separately.

**Every out-of-scope item also gets a category**, so the report can say *why*
things are excluded rather than only how many:

| `out_of_scope_category` | Use for |
|---|---|
| `basic_neuroscience` | Technique-on-neural-tissue research with no device or interface intent |
| `drug_or_biologic` | Pharmacological or biologic studies with no neurotechnology component |
| `surgical_hardware_consumable` | Neurosurgical instruments, implants, navigation, and supplies |
| `non_nervous_system` | Cardiac, orthopedic, ophthalmic and other non-neural medicine |
| `other` | In none of the above |
| `in_scope` | Sentinel value used when `in_scope` is true |

---

## 2. Current scheme — which of the eight live classes apply?

Label these as the *current taxonomy intends them*, not as the current keyword
lists happen to behave. This is the baseline the new scheme is measured against,
so it must reflect the classes' intended meaning.

`recording` · `stimulation` · `interface` · `sensory` · `motor` ·
`closed-loop` · `cognitive` · `imaging`

Zero, one, or many may apply. An out-of-scope item gets an empty list.

---

## 3. Proposed facets

### Function — what it does to the nervous system (multi-valued)

| Value | Meaning |
|---|---|
| `records` | Senses or measures neural or neuromuscular activity (EEG, ECoG, intracortical, LFP, EMG, evoked potentials) |
| `stimulates` | Delivers energy to modulate neural activity (electrical, magnetic, optical, ultrasonic, chemical) |
| `images` | Produces a spatial map of structure or activity (fMRI, fNIRS, MEG, PET, functional ultrasound) |
| `decodes` | Converts recorded neural activity into an inference, command, or control signal — the defining operation of a BCI. Includes decoding algorithms with no hardware of their own. |
| `none` | In scope but does none of these (e.g. a company profile, a policy or ethics paper, a funding announcement) |

`none` is exclusive — never combine it with another value.

Overlap between the other four is expected and meaningful, not a defect. It is
what makes the derived badges work: **closed-loop** = `records` + `stimulates`;
**BCI** = `records` + `decodes`. A device that only records is not a BCI, and
that distinction is exactly what the current `interface` class fails to make.

### Access — how it reaches the nervous system (multi-valued)

| Value | Meaning |
|---|---|
| `non_invasive` | Nothing breaches the skin (EEG, TMS, tDCS, fNIRS, MEG, surface EMG, focused ultrasound) |
| `minimally_invasive` | Percutaneous or endovascular; no open surgery (Stentrode, percutaneous leads, injectable electrodes) |
| `implanted_non_penetrating` | Surgically placed, sits on a surface (subdural ECoG, epidural arrays, nerve cuffs, cochlear implants) |
| `implanted_penetrating` | Enters neural tissue (Utah array, Neuralink threads, DBS leads, depth electrodes) |
| `not_applicable` | Access is not a property of this item (software, a company, a review paper) |

**List every access route the item substantially involves.** A study comparing
EEG to ECoG gets both `non_invasive` and `implanted_non_penetrating` — a reader
filtering for non-invasive work should find it. Do not list a modality that is
merely mentioned in passing. `not_applicable` is exclusive.

### Target — where in the nervous system (multi-valued)

| Value | Meaning |
|---|---|
| `brain` | Cortex, deep structures, and cranial nerves acting on central function |
| `spinal_cord` | Cord or spinal roots, including epidural spinal stimulation |
| `peripheral_nerve` | Somatic peripheral nerves |
| `neuromuscular` | Muscle and the neuromuscular junction — surface EMG, FES to muscle, most rehabilitation devices |
| `autonomic` | Vagus, sacral, phrenic, sympathetic/parasympathetic targets |
| `not_applicable` | No specific target |

**Cranial-nerve precedence.** Several targets are cranial nerves with autonomic
function. Classify by what the intervention is *for*: vagus nerve stimulation
for epilepsy or depression is `brain` (it is being used to modulate central
activity); vagus stimulation for gastroparesis or dyspepsia is `autonomic`. When
both apply, list both. `not_applicable` is exclusive.

### Application — what problem it addresses (multi-valued)

`movement_restoration` · `communication_speech` · `sensory_restoration` ·
`epilepsy` · `movement_disorders` · `psychiatric` · `pain` ·
`cognition_memory` · `autonomic_organ` · `rehabilitation` · `diagnostics` ·
`research_tool` · `consumer_wellness`

`research_tool` is for in-scope instrumentation built to enable research rather
than to treat a condition. `diagnostics` is for measurement intended to
characterize a patient rather than to restore function.

---

## 4. Confidence

`high` — the item states enough to label it unambiguously.
`medium` — the label follows from strong inference.
`low` — the record is too sparse or too ambiguous to be sure. These are
reported separately and are the first candidates for human spot-check.
