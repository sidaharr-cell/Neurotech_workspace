# New facet classifier — scored against the gold set

439 items (391 random draw). 95% Wilson intervals.

## Scope agreement

Classifier agrees with the label on **75% [71-79] n=391** of rows.

- scope precision (predicted in-scope that really are): 74% [68-78] n=295
- scope recall (real in-scope that we keep): 92% [88-95] n=235

| content | scope agreement |
|---|---|
| papers | 72% [62-80] n=99 |
| patents | 49% [38-60] n=80 |
| devices | 92% [82-96] n=60 |
| trials | 88% [78-94] n=60 |
| news | 100% [84-100] n=20 |
| organizations | 77% [65-86] n=60 |
| researchers | 92% [65-99] n=12 |

## function

| value | precision | recall | prevalence |
|---|---|---|---|
| records | 66% [56-74] n=96 | 56% [45-66] n=82 | 21% [17-25] n=391 |
| stimulates | 71% [65-77] n=221 | 82% [76-87] n=164 | 42% [37-47] n=391 |
| images | 54% [39-68] n=39 | 81% [60-92] n=21 | 5% [4-8] n=391 |
| decodes | 80% [68-88] n=59 | 88% [74-95] n=41 | 10% [8-14] n=391 |
| **all function** | **69% [65-74] n=415** | **76% [71-80] n=308** | |

## access

| value | precision | recall | prevalence |
|---|---|---|---|
| non_invasive | 75% [66-81] n=122 | 71% [62-78] n=113 | 29% [25-34] n=391 |
| minimally_invasive | 43% [16-75] n=7 | 33% [12-65] n=9 | 2% [1-4] n=391 |
| implanted_non_penetrating | 56% [45-67] n=78 | 63% [51-74] n=60 | 15% [12-19] n=391 |
| implanted_penetrating | 56% [41-70] n=41 | 34% [23-47] n=53 | 14% [11-17] n=391 |
| **all access** | **65% [59-71] n=248** | **59% [53-65] n=235** | |

## application

| value | precision | recall | prevalence |
|---|---|---|---|
| movement_restoration | 76% [55-89] n=21 | 36% [23-52] n=39 | 10% [7-13] n=391 |
| communication_speech | 75% [30-95] n=4 | 20% [7-45] n=15 | 4% [2-6] n=391 |
| sensory_restoration | 79% [65-89] n=43 | 85% [69-93] n=33 | 8% [6-12] n=391 |
| epilepsy | 52% [33-70] n=25 | 83% [55-95] n=12 | 3% [2-5] n=391 |
| movement_disorders | 79% [60-90] n=28 | 76% [57-89] n=25 | 6% [4-9] n=391 |
| psychiatric | 75% [55-88] n=24 | 73% [52-87] n=22 | 6% [4-8] n=391 |
| pain | 68% [49-82] n=28 | 55% [38-71] n=31 | 8% [6-11] n=391 |
| cognition_memory | 69% [42-87] n=13 | 38% [14-69] n=8 | 2% [1-4] n=391 |
| autonomic_organ | 50% [9-91] n=2 | 7% [1-31] n=14 | 4% [2-6] n=391 |
| rehabilitation | 70% [52-84] n=27 | 39% [25-55] n=36 | 9% [7-12] n=391 |
| diagnostics | 23% [14-36] n=52 | 35% [21-53] n=31 | 8% [6-11] n=391 |
| research_tool | 33% [14-61] n=12 | 10% [4-23] n=41 | 10% [8-14] n=391 |
| consumer_wellness | 0% [0-43] n=5 | 0% [0-43] n=5 | 1% [1-3] n=391 |
| **all application** | **60% [54-65] n=284** | **45% [39-50] n=312** | |

## Abstention

Of in-scope items, 9% [6-14] n=217 received no function value — the classifier declined to guess rather than guessing wrong.
