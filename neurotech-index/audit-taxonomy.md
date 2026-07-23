# Device Class audit — full corpus

Generated 2026-07-23. Path A = stored tags (section pages, server-side `.contains`). Path B = regex over `JSON.stringify(entity)` (Feed, Search, Companies, directory rails).

## Coverage — rows reachable by any class pill

| Content | Rows | Path A tagged | Path B matched | A∩B identical |
|---|---:|---:|---:|---:|
| papers | 83,772 | 74,076 (88.4%) | 74,841 (89.3%) | 98.2% |
| patents | 47,360 | 43,422 (91.7%) | 11,230 (23.7%) | 17.5% |
| devices | 6,008 | 676 (11.3%) | 827 (13.8%) | 97.5% |
| trials | 8,329 | 6,463 (77.6%) | 6,106 (73.3%) | 89.3% |
| news | 165 | 0 (0.0%) | 165 (100.0%) | 0.0% |
| organizations | 1,796 | 592 (33.0%) | 579 (32.2%) | 96.6% |
| researchers | 12 | 0 (0.0%) | 12 (100.0%) | 0.0% |

## Overlap — how non-exclusive the scheme is (Path A)

| Content | 0 classes | 1 | 2 | 3+ | top co-occurring pair |
|---|---:|---:|---:|---:|---|
| papers | 11.6% | 54.4% | 26.4% | 7.6% | interface + recording (7,579) |
| patents | 8.3% | 79.0% | 10.6% | 2.0% | recording + stimulation (2,028) |
| devices | 88.7% | 11.1% | 0.2% | 0.0% | sensory + stimulation (3) |
| trials | 22.4% | 59.0% | 14.9% | 3.6% | recording + stimulation (550) |
| news | 100.0% | 0.0% | 0.0% | 0.0% | — |
| organizations | 67.0% | 28.3% | 4.1% | 0.6% | closed-loop + stimulation (21) |
| researchers | 100.0% | 0.0% | 0.0% | 0.0% | — |

## Divergence — same pill, different page


**papers** — identical on 98.2% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 25,937 | 0 | 449 |
| stimulation | 34,893 | 0 | 350 |
| interface | 14,546 | 0 | 242 |
| sensory | 18,120 | 0 | 119 |
| motor | 6,443 | 0 | 112 |
| closed-loop | 5,459 | 0 | 93 |
| cognitive | 52 | 0 | 0 |
| imaging | 4,527 | 0 | 689 |

**patents** — identical on 17.5% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 703 | 6,066 | 209 |
| stimulation | 5,120 | 30,712 | 908 |
| interface | 1,337 | 1,925 | 374 |
| sensory | 1,619 | 0 | 647 |
| motor | 796 | 477 | 296 |
| closed-loop | 679 | 0 | 55 |
| cognitive | 4 | 0 | 1 |
| imaging | 31 | 974 | 36 |

**devices** — identical on 97.5% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 257 | 0 | 15 |
| stimulation | 370 | 0 | 32 |
| interface | 1 | 0 | 5 |
| sensory | 11 | 0 | 13 |
| motor | 27 | 0 | 83 |
| closed-loop | 0 | 0 | 1 |
| imaging | 21 | 0 | 10 |

**trials** — identical on 89.3% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 618 | 305 | 4 |
| stimulation | 4,628 | 261 | 2 |
| interface | 301 | 59 | 0 |
| sensory | 839 | 71 | 1 |
| motor | 401 | 108 | 6 |
| closed-loop | 264 | 0 | 1 |
| cognitive | 3 | 1 | 0 |
| imaging | 286 | 235 | 2 |

**news** — identical on 0.0% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 0 | 0 | 97 |
| stimulation | 0 | 0 | 62 |
| interface | 0 | 0 | 106 |
| sensory | 0 | 0 | 12 |
| motor | 0 | 0 | 26 |
| closed-loop | 0 | 0 | 44 |
| imaging | 0 | 0 | 15 |

**organizations** — identical on 96.6% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 80 | 9 | 8 |
| stimulation | 204 | 18 | 1 |
| interface | 80 | 3 | 10 |
| sensory | 156 | 7 | 2 |
| motor | 42 | 10 | 2 |
| closed-loop | 48 | 0 | 1 |
| imaging | 31 | 1 | 2 |

**researchers** — identical on 0.0% of rows

| class | both agree | section page only | feed/search only |
|---|---:|---:|---:|
| recording | 0 | 0 | 7 |
| interface | 0 | 0 | 12 |
| sensory | 0 | 0 | 2 |
| motor | 0 | 0 | 12 |
| closed-loop | 0 | 0 | 2 |
| imaging | 0 | 0 | 2 |

## Keyword false-positive leads

Keywords whose matches are mostly *other words*. `share` = fraction of first-matches that were not the keyword standing alone.

| content | keyword | fires | top containing words | suspect share |
|---|---|---:|---|---:|
| papers | `recording:ecog` | 7,087 | recognition (3561), ecog (1796), recognized (753), recognize (275) | 74.7% |
| papers | `recording:electrophysiolog` | 4,727 | electrophysiological (2992), electrophysiology (1357), electrophysiologic (224), electrophysiologically (99) | 100.0% |
| papers | `recording:electrocorticograph` | 3,234 | electrocorticography (2079), electrocorticographic (947), micro-electrocorticography (60), micro-electrocorticographic (25) | 99.6% |
| papers | `interface:synchron` | 3,118 | synchronization (606), desynchronization (453), synchronized (438), synchrony (402) | 99.8% |
| papers | `interface:encod` | 2,997 | encoding (1126), encoded (884), encode (416), encodes (225) | 100.0% |
| papers | `motor:prosthes` | 2,865 | prosthesis (1128), prostheses (614), neuroprosthesis (567), neuroprostheses (514) | 100.0% |
| patents | `motor:prosthes` | 907 | prosthesis (608), neuroprosthesis (184), prostheses (95), neuroprostheses (11) | 100.0% |
| patents | `interface:synchron` | 644 | resynchronization (250), synchronization (100), synchronized (68), synchronous (33) | 96.1% |
| patents | `stimulation:stimulator` | 1,668 | stimulator (1080), neurostimulator (249), stimulators (127), biostimulator (45) | 35.3% |
| patents | `interface:decod` | 279 | decoding (258), decoder (8), decoded (7), decode (4) | 100.0% |
| patents | `recording:electrophysiolog` | 177 | electrophysiological (100), electrophysiology (58), electrophysiologic (13), neuroelectrophysiological (2) | 100.0% |
| patents | `recording:ecog` | 169 | recognition (107), recognizing (30), ecog (14), recognize (4) | 91.7% |
| devices | `motor:fes` | 105 | lifesciences (63), professionals (14), fes (11), professional (7) | 89.5% |
| devices | `imaging:meg` | 27 | omega (16), meg (4), mega-iom (1), megvision (1) | 85.2% |
| devices | `stimulation:tms` | 64 | tms (45), dtms (4), cloudtms (3), rtms (3) | 29.7% |
| trials | `stimulation:tms` | 1,135 | rtms (574), tms (467), dtms (24), tms-eeg (6) | 58.9% |
| trials | `motor:fes` | 250 | fes (97), manifestations (25), lifestyle (21), professionals (12) | 61.2% |
| trials | `recording:electrophysiolog` | 141 | electrophysiological (94), electrophysiology (36), electrophysiologic (4), neuroelectrophysiological (2) | 100.0% |
| trials | `stimulation:stimulator` | 450 | stimulator (333), neurostimulator (70), stimulators (25), dc-stimulator (5) | 26.0% |
| trials | `recording:ecog` | 121 | recognition (48), ecog (30), recognized (30), recognizing (2) | 75.2% |
| trials | `motor:prosthes` | 83 | prosthesis (43), neuroprosthesis (27), prostheses (6), neuroprostheses (4) | 100.0% |
| news | `interface:decod` | 52 | decoding (40), decode (7), decoder (2), decodes (2) | 100.0% |
| news | `interface:neural interface` | 28 | neural interfaces (22), neural interface (6) | 78.6% |
| news | `recording:eeg` | 25 | eeg (17), eeg-based (5), eeg-mi-bci (1), beegqxlxveng (1) | 32.0% |
| organizations | `motor:prosthes` | 28 | prostheses (11), prosthesis (8), neuroprosthesis (7), neuroprostheses (2) | 100.0% |
| organizations | `recording:electrophysiolog` | 23 | electrophysiology (14), electrophysiological (9) | 100.0% |
| organizations | `interface:bci` | 25 | bci (14), bcis (4), ibci (2), bci-mediated (1) | 44.0% |

## Unclassified by both paths — worklist samples


**papers** — first 10 of 9,696 untagged:

- Neuropeptides in Obesity and Metabolic Disease.
- Specific expression of channelrhodopsin-2 in single neurons of Caenorhabditis elegans.
- Hypothalamic thermoregulatory neurons divergently modulate isoflurane anesthesia via temperature dependent and independe
- GABA Signaling in the Posterodorsal Medial Amygdala Mediates Stress-induced Suppression of LH Pulsatility in Female Mice
- Shedding light on stem cells: Optogenetics uncover the role of ERK dynamics in pluripotency.
- Optically Induced Calcium-Dependent Gene Activation and Labeling of Active Neurons Using CaMPARI and Cal-Light.
- Neuronal Activity Promotes Glioma Growth through Neuroligin-3 Secretion.
- Organelle Optogenetics: Direct Manipulation of Intracellular Ca Dynamics by Light.
- The 'hand paradox': distorted representations guide optimal actions.
- Glutamatergic neurons of the gigantocellular reticular nucleus shape locomotor pattern and rhythm in the freely behaving

**patents** — first 10 of 3,938 untagged:

- Flexible neural probe for magnetic insertion
- Systems and biomedical devices for sensing and for biometric based information …
- Polyisobutylene urethane, urea and urethane/urea copolymers and medical devices …
- Electrode for Electroencephalograph
- Multi-channel neural signal amplifier system providing high cmrr across an …
- Apparatus and method for real time control of effectors
- Multi-physical-factor stimulation nerve regulation and control device and …
- Gahnic asclepius: integrated remote diagnostic and surgical system using cross- …
- Implantable guide element and methods of fabrication and use thereof
- Cognitive Management Method and System

**devices** — first 10 of 5,332 untagged:

- DYNATRON 350 EMG/BIOFEEDBACK ANALYZER
- CONDUCTIVE CREAM-500
- MICROLET FAMILY OF NEEDLE/DEPTH ELECT-
- NIHON KOHDEN NEUROPACK SIGMA MEB-5500A EVOKED RESPONSE & EMG MEASURING SYSTEM
- CARBON ELECTRODE
- AT33 EMG
- GELSPHERES MICROSPHERES AND BEAD BLOCK COMPRESSIBLE MICROSPHERES
- O&P BIVALVE CRANIAL MOLDING HELMET
- NAVIGUS FIDUCIAL MARKER SYSTEM, MODELS FM-1000, FM-2000
- AXION IV GOLDLINE SERIES

**trials** — first 10 of 1,866 untagged:

- Transcutaneous Direct Current Stimulation of the Spinal Cord for Treatment of Spasticity in Multiple Sclerosis
- MyndMove Therapy for Severe Hemiparesis of the Upper Limb Following Stroke
- MyndMove Therapy for Severe Hemiparesis of the Upper Limb Following Stroke
- Brief ES for Recovery of Autonomic Function in CES
- High Resolution Gastric Mapping and Gastroduodenal Manometry
- Effect of Transcutaneous Auricular Vagal Nerve Stimulation on Functional Dyspepsia
- Neuro-Intermuscular Coordination Enhancement (NICE) Rehabilitation Through Human-Machine Interaction in Chronic Stroke
- Remote Participation (Within USA) Trial of Sana Pain Reliever
- A Study Assessing Corneal Endothelial Cells in Participants With Neovascular Age-related Macular Degeneration (nAMD) Tre
- Cerebral Responses During Bilateral/Unilateral Sacral Nerve Stimulation for Idiopathic Faecal Incontinence

**organizations** — first 10 of 1,204 untagged:

- Yoichi  Osawa Lab
- Waleed M Abuzeid Lab
- Katherine Anne Henzler-Wildman Lab
- Alexandra V. Ulyanova Lab
- Mitchell L Sutter Lab
- Taylor Marie Cannon Lab
- Carolyn M Salafia Lab
- Joseph T Francis Lab
- Sean D Stocker Lab
- Lee-Way  Jin Lab

## Non-class values found in the tag fields

- **papers.tags** — 68 distinct non-class values, e.g. Machine learning (197), Clinical trial (142), TMS (124), BCI (106), Motor cortex (95), EEG (89), Neural recording (85), DBS (77)
- **devices.tags** — 43 distinct non-class values, e.g. EEG (4), BCI (3), Research (3), Clinical (3), Consumer (3), Motor cortex (2), FDA (2), Implant (2)
- **news.topics** — 36 distinct non-class values, e.g. BCI (82), Neural recording (68), Clinical trial (62), Machine learning (59), Implant (57), Motor cortex (40), DBS (26), EEG (24)
- **organizations.focus_areas** — 48 distinct non-class values, e.g. BCI (4), Motor cortex (3), Neural recording (2), Paralysis (2), Utah array (1), BCI hardware (1), Clinical (1), Neuroprosthetics (1)
- **researchers.expertise** — 46 distinct non-class values, e.g. Motor cortex (6), BCI (5), Population coding (2), Neuroprosthetics (2), ALS (2), Neural decoding (2), Clinical translation (2), Calcium imaging (1)
