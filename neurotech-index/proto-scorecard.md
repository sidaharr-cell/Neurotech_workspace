# Proposed matcher vs. live matcher

Graded on the same 439 gold-set items. 95% Wilson intervals.

| class | precision A (stored) | precision B (live regex) | precision PROPOSED | recall A | recall B | recall PROPOSED |
|---|---|---|---|---|---|---|
| recording | 49% [38-61] | 61% [50-71] | 71% [60-80] | 33% [24-44] | 49% [39-60] | 53% [42-64] |
| stimulation | 70% [63-76] | 85% [77-90] | 71% [64-77] | 66% [58-73] | 55% [47-62] | 73% [66-79] |
| interface | 67% [52-79] | 74% [63-83] | 86% [75-93] | 24% [16-36] | 61% [49-71] | 59% [47-70] |
| sensory | 64% [51-76] | 66% [53-76] | 69% [55-79] | 84% [68-93] | 97% [84-99] | 94% [80-98] |
| motor | 41% [25-59] | 46% [32-61] | 57% [41-72] | 17% [7-34] | 40% [25-58] | 47% [30-64] |
| closed-loop | 58% [36-77] | 67% [47-82] | 79% [57-91] | 42% [19-68] | 83% [55-95] | 75% [47-91] |
| cognitive | 83% [44-97] | 83% [44-97] | 60% [31-83] | 0% [0-19] | 0% [0-19] | 6% [1-28] |
| imaging | 41% [23-61] | 50% [31-69] | 46% [30-62] | 33% [17-55] | 48% [28-68] | 57% [37-76] |
| **all classes** | **61% [57-66]** | **69% [65-74]** | **70% [66-74]** | **46% [41-51]** | **55% [50-60]** | **63% [59-68]** |

## Coverage of in-scope items

- stored tags (A): 70% [64-76]
- live regex (B): 73% [67-78]
- proposed: 86% [81-90]

## False alarms on rows that are not neurotech at all

- stored tags (A): 47% [39-55] get a category anyway
- live regex (B): 25% [19-32]
- proposed: 46% [39-54]
