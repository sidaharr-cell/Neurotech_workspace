# Classifier scorecard vs. gold set

Generated 2026-07-23 · rubric v2 · 439 labeled items (391 random draw, 48 precision supplement).

All figures carry 95% Wilson intervals. **Recall and prevalence use the random draw only**; precision pools both draws, which is a class-conditional sample and not population-weighted.

## 1. Scope — is the index full of things that belong in it?

Of the random draw, **60% [55–65] n=391** of rows are in-scope neurotech under the rubric.

| Content type | in scope | tagged by section pages | tagged by feed/search |
|---|---|---|---|
| papers | 64% [54–72] n=99 | 88% [80–93] n=99 | 88% [80–93] n=99 |
| patents | 48% [37–58] n=80 | 95% [88–98] n=80 | 25% [17–35] n=80 |
| devices | 42% [30–54] n=60 | 10% [5–20] n=60 | 12% [6–22] n=60 |
| trials | 87% [76–93] n=60 | 88% [78–94] n=60 | 82% [70–89] n=60 |
| news | 100% [84–100] n=20 | 0% [0–16] n=20 | 100% [84–100] n=20 |
| organizations | 42% [30–54] n=60 | 27% [17–39] n=60 | 27% [17–39] n=60 |
| researchers | 100% [76–100] n=12 | 0% [0–24] n=12 | 100% [76–100] n=12 |

### Why out-of-scope rows are in the index

| reason | rows | share of all out-of-scope |
|---|---:|---:|
| basic_neuroscience | 43 | 28% |
| other | 36 | 23% |
| non_nervous_system | 36 | 23% |
| surgical_hardware_consumable | 33 | 21% |
| drug_or_biologic | 8 | 5% |

## 2. Coverage — of items that DO belong, how many are reachable by a pill?

| Content type | section pages | feed/search |
|---|---|---|
| papers | 95% [87–98] n=63 | 95% [87–98] n=63 |
| patents | 100% [91–100] n=38 | 42% [28–58] n=38 |
| devices | 24% [11–43] n=25 | 24% [11–43] n=25 |
| trials | 94% [84–98] n=52 | 88% [77–95] n=52 |
| news | 0% [0–16] n=20 | 100% [84–100] n=20 |
| organizations | 48% [30–67] n=25 | 48% [30–67] n=25 |
| researchers | 0% [0–24] n=12 | 100% [76–100] n=12 |
| **all** | **70% [64–76] n=235** | **73% [67–78] n=235** |

## 3. Per-class accuracy of the current eight classes


**Section pages (stored tags)**

| class | precision | recall | gold prevalence |
|---|---|---|---|
| recording | 49% [38–61] n=73 | 33% [24–44] n=81 | 21% [17–25] n=391 |
| stimulation | 70% [63–76] n=176 | 66% [58–73] n=162 | 41% [37–46] n=391 |
| interface | 67% [52–79] n=42 | 24% [16–36] n=66 | 17% [13–21] n=391 |
| sensory | 64% [51–76] n=53 | 84% [68–93] n=32 | 8% [6–11] n=391 |
| motor | 41% [25–59] n=27 | 17% [7–34] n=30 | 8% [5–11] n=391 |
| closed-loop | 58% [36–77] n=19 | 42% [19–68] n=12 | 3% [2–5] n=391 |
| cognitive | 83% [44–97] n=6 | 0% [0–19] n=16 | 4% [3–7] n=391 |
| imaging | 41% [23–61] n=22 | 33% [17–55] n=21 | 5% [4–8] n=391 |

**Feed / Search (regex)**

| class | precision | recall | gold prevalence |
|---|---|---|---|
| recording | 62% [51–72] n=81 | 51% [40–61] n=81 | 21% [17–25] n=391 |
| stimulation | 85% [77–90] n=125 | 56% [48–63] n=162 | 41% [37–46] n=391 |
| interface | 74% [63–83] n=70 | 61% [49–71] n=66 | 17% [13–21] n=391 |
| sensory | 66% [53–76] n=58 | 97% [84–99] n=32 | 8% [6–11] n=391 |
| motor | 46% [32–61] n=39 | 40% [25–58] n=30 | 8% [5–11] n=391 |
| closed-loop | 67% [47–82] n=24 | 83% [55–95] n=12 | 3% [2–5] n=391 |
| cognitive | 83% [44–97] n=6 | 0% [0–19] n=16 | 4% [3–7] n=391 |
| imaging | 50% [31–69] n=24 | 48% [28–68] n=21 | 5% [4–8] n=391 |

## 4. Do the two paths agree with each other?

The two classifiers return identical class sets on **76% [72–80] n=439** of gold items.

## 5. How much of this is measurable?

Label confidence: medium 143 · high 210 · low 86.

Labeler self-agreement on an independent second pass — the ceiling any classifier can be measured against:

| field | agreement |
|---|---|
| in_scope | 100% [94–100] n=60 |
| current_classes | 82% [70–89] n=60 |
| function | 98% [91–100] n=60 |
| access | 97% [89–99] n=60 |
| target | 95% [86–98] n=60 |
| application | 90% [80–95] n=60 |

## 6. The proposed facets, over in-scope items


**function** — stimulates 70% · records 35% · decodes 17% · images 9% · none 4%

**access** — non_invasive 48% · implanted_non_penetrating 26% · implanted_penetrating 23% · not_applicable 6% · minimally_invasive 4%

**target** — brain 67% · spinal_cord 11% · peripheral_nerve 11% · neuromuscular 10% · autonomic 8% · not_applicable 5%

**application** — research_tool 17% · movement_restoration 17% · rehabilitation 15% · sensory_restoration 14% · pain 13% · diagnostics 13% · movement_disorders 11% · psychiatric 9% · communication_speech 6% · autonomic_organ 6% · epilepsy 5% · cognition_memory 3% · consumer_wellness 2%


Non-exclusivity of the **current** scheme, measured on labels rather than keywords: **47% [41–54] n=235** of in-scope items genuinely belong to two or more of the eight classes.

Derived badges under the proposed scheme: **BCI** (records+decodes) 17% [12–22] n=235 · **closed-loop** (records+stimulates) 12% [8–17] n=235.
