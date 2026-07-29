# NeuroBase: Potential Impact Ranking

**Build specification for Claude Code**
**Version:** 1.0
**Supersedes:** Ranking Spec v1.1 "Most Significant" sort, and drafts v0.1 and v0.2 of this amendment.
**Status:** Approved for implementation. Ship behind a flag until Phase 5 (calibration) passes.

---

## 0. How to use this document

Sections 1 through 3 are context. Read them before writing code. Sections 4 through 9 are the specification proper and are normative. Section 11 is the build order with acceptance criteria; work through it in sequence. Section 14 lists decisions that are not yet made. If you hit one of them, stop and ask rather than choosing.

Where this document says MUST, it is a hard requirement and a test should enforce it. Where it says SHOULD, use judgment and say what you chose.

---

## 1. What is being built

The "Most Significant" sort is removed entirely and replaced by "Highest Potential Impact."

**Why.** Significance was computed from retrospective consensus signals (citations, attention, source prominence). Those are lagging indicators. They reward normal-science work in large, well-populated subfields, and they penalize work that opens a direction few people are working in yet. The sort was accurate about what the field currently values and uninformative about where the field is going.

**What replaces it.** A rubric-scored judgment of whether an item moves the achievable frontier of neurotechnology outward, or removes a constraint holding that frontier in place. Scoring is anchored against a maintained record of current field state (Section 3.1), not against the model's own sense of importance.

**What this system is not.** It is a density filter, not an oracle. It raises the proportion of frontier-relevant items in a top 20. It cannot rank-order two plausible breakthroughs by eventual impact, and no part of the implementation should be built as if it can. Design accordingly: hedge in the copy, surface reasons, log everything.

---

## 2. Non-negotiable constraints

These are the failure modes this design exists to prevent. Violating one silently reintroduces the problem the rebuild is meant to fix.

**MUST NOT** use citation count, download count, altmetric, view count, social engagement, or source prominence as an input to the score at any stage. They may be stored and displayed. They are not scoring inputs.

**MUST NOT** ask the model an unanchored importance question ("how important is this," "rate the significance"). Every judgment is scored as a comparison against a retrieved frontier record or against a named, checkable property. Unanchored importance questions collapse into vocabulary matching, and the model will learn that "first," "unprecedented," and press-release register mean important.

**MUST NOT** let rhetorical markers raise any dimension score. Superlatives, novelty claims, and promotional framing are not evidence.

**MUST NOT** sum dimension scores. Composition is multiplicative with a ceiling (Section 6). Additive rubrics let a mediocre item accumulate rank from breadth.

**MUST NOT** surface numeric scores, dimension names, or rubric vocabulary in the user interface. Section 9 defines the entire user-facing surface.

**MUST NOT** score Organizations. See Section 4.

**MUST** emit a specific referent from the item's content for every dimension score above 0. A score with no referent is rejected in post-processing.

**MUST** log every gated item with a reason code. Silently dropped items are unauditable.

---

## 3. Data model

### 3.1 FrontierRecord

The anchor layer. Without it the rest of the system does not work.

```typescript
type AxisType =
  | "performance"       // decoding rate, accuracy, stimulation selectivity
  | "longevity"         // chronic viability, device lifetime
  | "invasiveness"      // surgical burden, reversibility
  | "scale"             // channel count, coverage area, cohort size
  | "regulatory"        // approval class, designation, predicate status
  | "manufacturability" // yield, unit cost, fabrication accessibility
  | "cost"              // procedure cost, reimbursement rate
  | "evidence";         // strongest evidence class for an indication (trials)

interface FrontierRecord {
  record_id: string;
  subfield: Subfield;              // enum, see 3.3
  axis: string;                    // "decoded words per minute, chronic, ALS"
  axis_type: AxisType;
  current_value: string;           // units REQUIRED in the string
  held_by: ItemRef;                // the NeuroBase item holding the record
  established_date: string;        // ISO date
  confidence: "replicated" | "single-group" | "claimed-only";
  superseded_by: RecordRef | null;
  record_version: number;
  notes: string;
}
```

`axis_type: "evidence"` exists for Trials. It records the current strongest evidence class for an indication (for example, "largest randomized comparator trial in treatment-resistant depression, n = 200, 2024"). Without it trials have nothing to be scored against.

**Record updates** are a write path, triggered when an item scores a frontier delta at or above threshold. Updating a record MUST require evidence grade `demonstrated` or better. Claims never update a record. A claim MAY create a new record at `confidence: "claimed-only"`, which is scoreable but does not raise the bar for other items.

Record revisions change historical scores. Records carry `record_version` and a change log so that is traceable.

### 3.2 ImpactScore

Internal only. None of this renders to users.

```typescript
interface DimensionScore {
  score: 0 | 1 | 2 | 3 | 4;
  justification: string;   // one sentence
  referent: string;        // quoted or pointed-to content from the item
}

interface ImpactScore {
  item_id: string;
  entity_type: "research" | "device" | "trial" | "feed";
  rubric_version: string;              // "1.0"
  potential_impact: number;
  path_taken: "frontier" | "leverage" | "gap" | "gate";

  // Research and Devices
  FD?: DimensionScore;                 // frontier delta
  LV?: DimensionScore & { beneficiaries: string[] };
  TR?: DimensionScore;                 // transferability

  // Trials
  GAP?: DimensionScore;                // evidence gap
  GATE?: DimensionScore & { unlocks: string[] };
  METH?: DimensionScore;               // methodological precedent

  translational_distance: 0 | 1 | 2 | 3 | 4;
  evidence_grade: string;
  evidence_variant: "standard" | "trial_design";

  claim_vs_demonstration: {
    claimed: string;
    demonstrated: string;
    gap_flagged: boolean;
  };

  frontier_records_consulted: string[];
  record_update_proposed: RecordUpdateProposal | null;
  gates_triggered: GateCode[];
  flags: Flag[];                       // see 5.5
  uncertainty: "low" | "medium" | "high";

  user_facing_reason: string;          // one sentence, plain language
  tags: UserTag[];                     // closed set, see 9.2
  scored_at: string;
}
```

### 3.3 Subfield enum

Starting partition. Reconcile against the existing Devices and Research taxonomies before implementing; if they conflict, stop and ask (open decision 6).

```
INVASIVE_BCI_INTRACORTICAL
INVASIVE_BCI_ECOG
BCI_MINIMALLY_INVASIVE      // includes endovascular
BCI_NONINVASIVE             // EEG, fNIRS, and related
DBS                          // open loop and adaptive
CLOSED_LOOP_EPILEPSY
PERIPHERAL_CRANIAL_NERVE_STIM
SPINAL_CORD_STIM_AND_BYPASS
FOCUSED_ULTRASOUND
INTERFACE_MATERIALS
DECODING_ALGORITHMS
SENSORY_PROSTHETICS
IMAGING_AND_RECORDING_HARDWARE
```

Treat the partition as versioned data, not as code. It will change.

---

## 4. Scope by entity type

| Entity | Scored | Rubric |
|---|---|---|
| Research | Yes | 5.1 |
| Devices | Yes | 5.1, with the device rules in 5.1.4 |
| Trials | Yes | 5.2 |
| Feed | Yes | Resolve to underlying entity, apply that rubric |
| Organizations (companies and labs) | **No** | Excluded |
| People | No | Inbound links only, per existing taxonomy |

**Organizations are excluded deliberately.** An organization is a container for units of impact, not a unit of impact. Aggregating its items produces a headcount-and-output proxy, which reproduces exactly the popularity bias this rebuild removes. Scoring an organization's self-description has no demonstration to check against and is the hype failure mode in pure form. Organizations keep their existing sort untouched. Do not add a potential-impact sort to the Organizations tab. If an organization-level view is wanted later it will be a labelled rollup of already-scored items, and that is out of scope here.

---

## 5. Rubrics

All dimensions are scored 0 to 4. Every score above 0 MUST carry a one-sentence justification and a specific referent.

### 5.1 Research and Devices

#### 5.1.1 Frontier delta (FD)

- **0.** No relationship to any frontier record. Confirmatory, incremental within an established range, or a re-report of existing capability.
- **1.** Moves a record along an axis by a margin within normal variation for that axis.
- **2.** Moves a record by a margin outside normal variation, or sets a first record on an axis previously measured but unrecorded.
- **3.** Opens a new axis. Demonstrates a capability that had no prior record because nobody had achieved that category of thing.
- **4.** Collapses a tradeoff. Improves one axis without the loss along a paired axis the field treats as necessary (channel count against chronic viability, invasiveness against bandwidth, selectivity against coverage, efficacy against titration burden).

Score 4 MUST name both paired axes and state why the tradeoff was previously considered binding.

#### 5.1.2 Leverage (LV)

Whether the item lowers the cost of future work for parties other than its authors. Covers bottleneck removal, released artifacts (weights, datasets, hardware designs, protocols), and precedent (regulatory, reimbursement, standards).

- **0.** No leverage. Closed result, no artifact, no precedent, no constraint identified.
- **1.** Relieves a constraint local to the authors' own setup, or releases an artifact under restrictive or undocumented terms.
- **2.** Relieves a constraint shared by several groups, releases a usable artifact, or sets a narrow precedent.
- **3.** Relieves a constraint blocking an entire subfield, or materially lowers cost for a subfield.
- **4.** Relieves a constraint blocking multiple subfields, or changes what is economically or legally feasible for a device class.

Score 2 and above MUST populate `beneficiaries` with at least one named party other than the authors. This is the anti-hallucination control. If the model cannot name who benefits, it invented the constraint, and post-processing MUST reject the score to 0.

#### 5.1.3 Transferability (TR)

- **0.** Specific to one subject, device, or dataset, with no stated path to generalization.
- **1.** Transferable within the same platform.
- **2.** Transferable across platforms within the subfield.
- **3.** Transferable across subfields.
- **4.** General tool. Applicable outside neurotechnology, or to problems the authors did not address.

#### 5.1.4 Device-specific rules

The unit of impact for a device is the capability it makes routinely available, not a one-off demonstration. A device that makes an already-demonstrated capability reliable, manufacturable, and reimbursable MAY score FD 3 or 4 while demonstrating nothing new in a research sense. This is intended.

- Recency for devices MUST be computed from `last_status_change`, not from first index date. A 2019 approval still holding the frontier must not decay out.
- Regulatory status scores through LV, not FD. A breakthrough device designation is a precedent and a class-level cost reduction. It is not itself a frontier movement.

### 5.2 Trials

Trials get their own dimensions. The v0.2 approach of reinterpreting the research rubric did not fit: a trial has demonstrated nothing at scoring time, its unit of impact is the knowledge it will produce, and its leverage runs through regulatory and methodological channels rather than through artifacts.

**Note on what is not a dimension here.** Decisiveness (whether the trial can actually resolve its question) is deliberately not a dimension. It functions as a multiplier, because a trial that cannot resolve anything should be suppressed regardless of how open its question is. It lives in the design-quality evidence grade at 5.3.2. Do not add it as a fourth dimension.

#### 5.2.1 Evidence gap (GAP)

How open is the question this trial is designed to answer. Scored against `axis_type: "evidence"` frontier records for the indication and intervention class.

- **0.** Question is settled. A prior adequately powered trial has answered it, and this trial does not address a stated limitation of that trial.
- **1.** Crowded question. Several trials are running or completed on substantially the same intervention and indication. Incremental confirmation.
- **2.** Real but bounded gap. Extends an answered question to a new population, a new stimulation parameter set, a longer follow-up, or a comparator that has not been tested.
- **3.** First adequately powered test of an intervention class in an indication where only open-label or single-arm evidence exists.
- **4.** First clinical test of an intervention class, or first trial in an indication with no prior interventional evidence of any kind.

GAP MUST cite the evidence records consulted. A GAP score above 0 with an empty `frontier_records_consulted` is rejected in post-processing.

#### 5.2.2 Translational gating (GATE)

What completing this trial unlocks. This is the trial analogue of leverage, and it is the dimension that captures why pivotal trials matter more than their scientific content suggests.

- **0.** Completion unlocks nothing beyond a publication.
- **1.** Supports an incremental label expansion or a single-site practice change.
- **2.** Supports an approval or label expansion for one device in one indication.
- **3.** Establishes a regulatory or reimbursement pathway that other devices in the class can follow, or serves as a predicate for a category.
- **4.** Gates market access for an entire intervention class, or would establish first-in-class reimbursement where none exists.

Score 2 and above MUST populate `unlocks` with the specific approval, pathway, indication, or coverage decision at stake. Generic entries ("would advance the field") MUST be rejected to 0.

#### 5.2.3 Methodological precedent (METH)

Whether the trial produces reusable methodology or generalizable mechanistic knowledge. Neurotechnology has a standing endpoint-validity problem: what counts as meaningful BCI performance, or meaningful quality-of-life improvement under neuromodulation, is not settled. A trial that establishes a usable endpoint has downstream leverage far beyond its own result.

- **0.** Standard design, standard endpoints, result confined to the specific intervention and indication.
- **1.** Minor methodological adaptation, reusable within the same program.
- **2.** Introduces an endpoint, outcome measure, blinding approach, or control design that others in the subfield could adopt, or the result informs a closely related indication.
- **3.** Establishes an endpoint or trial design likely to become standard for the subfield, or tests a mechanism whose answer generalizes across indications.
- **4.** Resolves a methodological question blocking trial design across multiple subfields (for example, a validated sham control for a modality that lacked one, or a validated functional endpoint applicable across interface types).

Mechanistic generalization is folded in here rather than given its own dimension, because in practice a trial that generalizes mechanistically is almost always one that also produces reusable measurement.

#### 5.2.4 Trial-specific rules

- **Informative failure is high impact.** A trial designed so that a null result closes a direction scores higher than one that cannot resolve anything in either direction. This is scored through the design-quality grade (5.3.2), not by penalizing risk.
- **Enrollment status affects horizon, not score.** A well-designed trial that has not begun enrolling is not less important than one enrolling now.
- **Terminated and withdrawn trials are gated out** (gate code `TRIAL_TERMINATED`). Completed trials are not: they remain scoreable and their results feed record updates.
- **Sponsor independence is a flag, not a penalty.** Most neurotechnology trials are industry-sponsored and penalizing that would gut the tab. Record it in `flags` and surface it (Section 9.2). It does not enter the score.

### 5.3 Evidence grade

Separates what an item claims from what it demonstrates or is designed to establish. This is the primary anti-hype control and it is applied as a multiplier, so it can suppress an otherwise high score.

#### 5.3.1 Standard variant (Research, Devices)

| Grade | Definition | Multiplier |
|---|---|---|
| `replicated` | Independent group has reproduced the core result | 1.00 |
| `demonstrated` | Item's own data supports the scored claim, methods disclosed sufficiently to assess | 1.00 |
| `partial` | Core result supported, key details withheld or underpowered | 0.75 |
| `claimed-only` | Assertion without disclosed supporting data | 0.40 |
| `contradicted` | Conflicts with a higher-confidence record without addressing the conflict | gate |

#### 5.3.2 Design-quality variant (Trials)

This is where decisiveness lives.

| Grade | Definition | Multiplier |
|---|---|---|
| `decisive` | Registered, randomized or with an adequate comparator, pre-specified primary endpoint, powered for it, and a null result would be interpretable | 1.00 |
| `strong` | Registered, pre-specified primary endpoint, adequate comparator, powering unclear or marginal | 0.90 |
| `indicative` | Registered with a pre-specified endpoint, single-arm or open-label where a comparator was feasible | 0.65 |
| `exploratory` | Registered, feasibility or safety only, no efficacy endpoint pre-specified | 0.50 |
| `announced-only` | Not registered, or registration lacks endpoint detail | 0.40 |

`decisive` requires the interpretable-null condition explicitly. A trial that can only produce a positive or an ambiguous result is at most `strong`.

#### 5.3.3 Universal scoring rules

**MUST** score every dimension against what is demonstrated or pre-specified, never against what is claimed. If an item announces a capability and shows data for a weaker one, score the weaker one and set `gap_flagged: true`.

**MUST NOT** let rhetorical markers raise any dimension. Log marker frequency per item for monitoring (Section 13).

### 5.4 Gates

Run before scoring. Gated items are excluded from this sort and logged with a reason code.

| Code | Condition |
|---|---|
| `CONTRADICTED` | Conflicts with a `replicated`-confidence record and does not engage the conflict. Carried over from v1.1. |
| `NO_SUBSTRATE` | Grade is `claimed-only` or `announced-only` and the item sets no regulatory, reimbursement, or standards precedent. |
| `RESTATEMENT` | Secondary report of an indexed primary. The primary is ranked; the secondary attaches as an inbound link and is not dropped from the index. |
| `TRIAL_TERMINATED` | Trial status is terminated or withdrawn. |
| `OUT_OF_SCOPE` | v1.1 scope rules, plus the Organizations exclusion. |

### 5.5 Flags

Recorded and displayed, never scored.

`industry_sponsored`, `single_site`, `preprint`, `slow_enrollment`, `conflict_disclosed`, `retracted_source_in_references`.

---

## 6. Composition

```
// Research and Devices
frontierPath = FD * (1 + 0.25*LV + 0.20*TR)
leveragePath = LV * (1 + 0.20*TR)
base = max(frontierPath, leveragePath)

// Trials
gapPath  = GAP  * (1 + 0.25*GATE + 0.20*METH)
gatePath = GATE * (1 + 0.20*METH)
base = max(gapPath, gatePath)

// Both
potential_impact = base * evidenceMultiplier * recency
path_taken = whichever path produced base
```

**Why two paths.** The old spec used a single ceiling on the advance dimension. That is right for frontier work and wrong for a category of items that matter and have no frontier delta at all: an encapsulation result extending chronic viability, a yield improvement making an existing array producible, a reimbursement decision for a device class, a standards publication enabling interoperability. None of these has rhetorical markers of importance. Nothing in their language signals significance. A scorer reading for salience misses them systematically, and they are among the highest-leverage items in the field. The second path lets them rank without loosening the ceiling on the first.

The same logic applies to trials. A methodologically ordinary trial that gates class-wide market access should rank, and `gatePath` is how.

**MUST NOT** sum the paths.

**Recency.** Use a gentler decay curve on this sort than on Feed, and make it a separate tunable constant, not a shared one. The premise of the filter is that important work is recognized slowly, so recency and prospective impact pull against each other. Devices use `last_status_change` (5.1.4). Trials use last registry update.

**No cross-subfield normalization at write time.** If one subfield dominates the feed, normalize at read time. Baking normalization into the stored score makes the calibration harness uninterpretable.

---

## 7. Scoring pipeline

Two passes. One call is cheaper, but the claim-versus-demonstration separation is the control the entire anti-hype design rests on, and it is materially more reliable when extraction happens before scoring.

### 7.1 Step 1: classify and retrieve

1. Classify the item to a subfield and entity type.
2. Retrieve all non-superseded FrontierRecords for that subfield. For trials, retrieve `axis_type: "evidence"` records for the indication as well.
3. If no records exist for the subfield, proceed with an empty record set. FD and GAP are then capped at 0 and the item can only rank via the leverage or gate path. Log this as `no_records_available`; a high rate means the record layer needs bootstrapping in that subfield.

### 7.2 Step 2: extract

Prompt returns JSON only, no prose, no code fences.

```
You are extracting factual content from a neurotechnology record for
downstream scoring. Do not evaluate importance. Do not summarize
persuasively.

Return JSON with these fields:

  claimed: What the item asserts is possible, achieved, planned, or
    implied. Use the item's own framing.
  demonstrated: What the item's disclosed evidence actually supports.
    For a trial, what the pre-specified design is capable of
    establishing. If evidence is not disclosed, return null.
  quantitative_results: Array of {metric, value, units, conditions}.
    Only values the item reports. Do not infer or convert.
  methods_disclosed: boolean. Are methods described in enough detail
    for an independent group to assess the claim.
  artifacts_released: Array of {type, terms, url}. Weights, datasets,
    hardware designs, protocols, code.
  constraints_addressed: Array of {constraint, who_else_is_blocked}.
    Only constraints the item explicitly names or clearly implies.
    who_else_is_blocked must be a named party other than the authors,
    or null.
  rhetorical_markers: Array of superlative or novelty terms used.
  trial_design: null for non-trials. Otherwise
    {registered, registry_id, randomized, comparator, blinding,
     primary_endpoint, prespecified, powered, null_interpretable,
     status, sponsor_type}.

Item:
---
{item_content}
---
```

### 7.3 Step 3: score

Separate call per rubric. Pass the retrieved records and the extraction output. Do not pass the raw item's promotional framing if it can be excluded.

```
Score this neurotechnology item against the rubric below. You are
comparing it to the frontier records provided. You are not judging
importance in the abstract.

Rules:
- Score against `demonstrated`, never against `claimed`.
- Every score above 0 requires a specific referent from the content.
  If you cannot point to something specific, the score is 0.
- Superlatives and novelty language are not evidence. Ignore them.
- If the item's subfield has no relevant record, {FD|GAP} is 0.
  This is expected and is not a failure.

Current frontier records for this subfield:
{records}

Extraction:
{extraction}

Rubric:
{rubric_anchors}

Return JSON:
{
  "{DIM1}": {"score": int, "justification": str, "referent": str},
  ...
  "frontier_records_consulted": [record_id],
  "record_update_proposed": {...} | null,
  "translational_distance": int,
  "evidence_grade": str,
  "uncertainty": "low"|"medium"|"high",
  "user_facing_reason": str
}

user_facing_reason: one sentence, plain field language, no rubric
terms, no numbers from this rubric, readable by someone who has
never seen this scoring system. State what the item does and what
it changes. If the item ranks on a claim rather than on data, say so.
```

### 7.4 Step 4: validate

Post-processing, deterministic, no model call. See Section 8.

### 7.5 Step 5: compose and store

Apply Section 6. Derive tags per 9.2. Write the ImpactScore. Queue any `record_update_proposed` for review (open decision 2 covers whether this is automatic or human-gated).

---

## 8. Post-processing validation

These MUST run as code, not as model instructions, because they are the checks on the model.

1. Any dimension score above 0 with an empty or generic `referent` is reset to 0.
2. `LV >= 2` with an empty `beneficiaries` array is reset to 1.
3. `GATE >= 2` with an empty or generic `unlocks` array is reset to 1. Maintain a reject list of generic strings ("advance the field", "help patients", "improve outcomes").
4. `FD > 0` or `GAP > 0` with an empty `frontier_records_consulted` is reset to 0.
5. `FD == 4` without two named paired axes is reset to 3.
6. `record_update_proposed` is discarded if evidence grade is below `demonstrated`.
7. `user_facing_reason` containing rubric vocabulary (dimension names, "score", "rubric", "frontier delta", "leverage") is regenerated. Cap at two attempts, then fall back to a templated sentence from the tags.
8. If `claimed` and `demonstrated` diverge materially, set `gap_flagged: true`.

Log every reset with item id, rule number, and original value. Reset rates are a monitoring signal: a rising rate on rule 1 or 3 means the model is drifting toward unanchored judgment.

---

## 9. User-facing surface

### 9.1 What does not appear

No numeric scores. No dimension names. No rubric vocabulary. No evidence multiplier. Users would have to learn the rubric to read any of it, and a number they cannot interpret invites false precision about a judgment this system has explicitly said it cannot make precisely.

### 9.2 What does appear

**The order.** This is the primary output.

**One plain-language sentence per item**, from `user_facing_reason`. Register examples:

- "Roughly doubles reported chronic electrode viability compared with the previous best in this class."
- "Removes the custom-fabrication step that has limited high-density arrays to a handful of labs."
- "First randomized comparator trial in this indication. A null result would close a direction several groups are pursuing."
- "Company announcement. No supporting data has been released."

**A closed set of tags**, derived deterministically. Never freehand.

| Tag | Derived from |
|---|---|
| Extends a field record | FD >= 2 |
| Opens a new direction | FD >= 3 |
| Removes a known bottleneck | LV >= 3 |
| Broadly applicable method | TR >= 3 |
| Answers an open question | GAP >= 3 |
| Gates approval for a device class | GATE >= 3 |
| Sets trial methodology | METH >= 3 |
| First in humans | TD == 2 |
| In clinical use | TD == 4 |
| No data released | grade is `claimed-only` or `announced-only` |
| Limited detail disclosed | grade is `partial` or `indicative` |
| Industry sponsored | flag `industry_sponsored` |

The disclosure tags matter most. They are the only visible sign the anti-hype control is running, and a user should be able to see when a highly ranked item ranks on a claim.

**Horizon filter**, derived from TD. Near-term (3 to 4), medium (2), long (0 to 1). A toggle rather than a blended list. "What is close to patients" and "what will matter eventually" are both coherent asks and one blended list serves neither.

### 9.3 Internal inspection view

Build this in the same phase as the scorer, not later.

Hiding the numbers means users cannot self-correct for miscalibration and their disagreement never becomes legible feedback. The inspection view is now the only place the rubric is visible. It MUST show the full ImpactScore object for any item, including every justification, referent, consulted record, gate, flag, and validation reset. Access-gate it however you like, but it has to exist before the sort ships.

---

## 10. Migration

1. Remove the "Most Significant" sort option from all tabs. No deprecation period, no dual display.
2. Preserve stored significance scores in a `legacy_significance` column. Do not delete. They are the comparison surface for evaluating the new sort, and deleting them makes the change unfalsifiable.
3. Rescore the full corpus under rubric 1.0. Items with `rubric_version` other than the current one MUST NOT appear in the sort.
4. Any saved user views, permalinks, or API parameters referencing the significance sort resolve to potential impact, with a one-time notice.
5. Organizations keep their existing sort. Confirm no code path attempts to score them.

---

## 11. Build order and acceptance criteria

**Phase 1: Record layer.** Schema, storage, CRUD, versioning, change log. Manual entry interface.
*Accepts when:* records can be created, superseded, and queried by subfield and axis type, and version history is retrievable.

**Phase 2: Record bootstrap.** Populate initial records. Estimate 5 to 10 axes across 13 subfields (65 to 130 records), plus evidence-axis records for indications represented in Trials. This is manual domain work and is on the critical path.
*Accepts when:* every subfield has at least three records, and every indication with more than two indexed trials has at least one evidence record.

**Phase 3: Extraction pass.** Section 7.2.
*Accepts when:* on a 50-item hand-labelled sample, `demonstrated` never contains content absent from the source, and `claimed` versus `demonstrated` divergence is correctly identified on at least 8 of 10 known-overclaiming items.

**Phase 4: Scoring, validation, composition.** Sections 7.3, 7.4, 6.
*Accepts when:* all validation rules in Section 8 fire correctly on constructed adversarial cases, and no dimension score above 0 survives without a referent.

**Phase 5: Calibration.** Section 12. Blocking. Do not ship as a default sort until this passes.

**Phase 6: User surface and inspection view.** Sections 9.2 and 9.3.

**Phase 7: Migration and monitoring.** Sections 10 and 13.

---

## 12. Calibration harness

This filter cannot be validated against ground truth, because ground truth arrives in five years. The retro-holdout is the closest available substitute.

1. Assemble a corpus from 2016 to 2019. **Include devices and trials, not only papers**, or the entity profiles go untested.
2. Build a frontier record set reflecting field state at the **start** of the window. This is expensive and it is not optional. Scoring 2017 items against 2026 records inverts the entire exercise.
3. Strip identifying context: authors, affiliations, venue, funder, company names. Replace named entities in body text with role placeholders where feasible.
4. Score the corpus.
5. Compare the top decile against an independently built list of what actually mattered from that window, constructed before anyone sees the scores.

**Primary metric is recall, not precision.** A top decile containing all five items that mattered plus fifteen that did not is a success. A high-precision top decile that misses two is a failure.

**Run the negative case.** Take window items that received heavy attention and did not pan out. The system should not rank them highly. This test is more diagnostic than the positive case because it targets hype correlation directly. If budget is constrained, run this one.

**Leakage is real and only partly mitigable.** The model knows what happened to adaptive DBS, to Neuralink, and to Stentrode. Entity stripping helps and does not eliminate it, since a distinctive method is identifiable from its description alone. Treat the result as evidence, not proof. It is still the difference between having evidence and having a vibe.

---

## 13. Monitoring

Review monthly. With scores hidden from users, this is the primary drift signal.

- Entity-type distribution of the top 50. Devices or Trials collapsing toward zero means a rubric or profile is broken.
- Subfield distribution of the top 50. Concentration signals a partition or record-coverage failure, not necessarily field reality.
- Source-type distribution. Company announcements above roughly 15% of the top 50 means the evidence multiplier is not working.
- Rate of proposed record updates. Near zero means the record layer is stale and items have nothing to compare against.
- Correlation between `rhetorical_markers` count and `potential_impact`. Should be near zero. Rising correlation is drift toward vocabulary matching and is the single most important number here.
- Path split across all four paths. If almost nothing takes `leverage` or `gate`, the boring-but-important category is being missed.
- Validation reset rates by rule number (Section 8).
- Gate log volume by code.
- Rank correlation with `legacy_significance`. Should be positive but weak. Near 1.0 means the rebuild changed nothing. Near 0 or negative warrants a look before assuming it is working.

---

## 14. Open decisions

Stop and ask if you hit one of these. Do not choose.

1. **Scorer input granularity.** Does the pipeline provide full text, abstract only, or metadata only? FD 3 and 4 and METH 3 and 4 require methods-level detail. On abstracts alone those levels are unreachable in practice, and the rubric should be capped and documented rather than specifying levels the pipeline cannot support.
2. **Record update gating.** Are `record_update_proposed` entries applied automatically above a confidence threshold, or queued for human review? Automatic is cheaper and risks a bad record poisoning every subsequent comparison in that subfield.
3. **Retro-holdout reference list authorship.** Self-constructing it introduces exactly the bias the test is meant to detect. Dr. Amadio or another domain expert building it blind to the scores would be materially stronger evidence.
4. **Trial indication taxonomy.** GAP and GATE both need an indication vocabulary that does not currently exist in the schema. Reuse the ClinicalTrials.gov condition field, or maintain a curated mapping?
5. **Subfield partition reconciliation.** Section 3.3 was written without access to the current Devices and Research taxonomies. If they conflict, the resolution is a product decision.
6. **Preprint handling.** A bioRxiv preprint can be `demonstrated` by the letter of 5.3.1. Whether preprints should carry an additional multiplier is unresolved. Currently they carry only a flag.

---

## 15. Reference

Prior art on the same construct. None of it solves the problem, and all of it is retrospective and citation-based, so the transfer is the construct definition and the documented failure modes, not the method.

- Wu, Wang and Evans, *Nature* 2019, CD index (small teams disrupt, large teams develop). https://www.nature.com/articles/s41586-019-0941-9
- Funk and Owen-Smith, *Management Science* 2017, original disruption index. https://pubsonline.informs.org/doi/10.1287/mnsc.2015.2366
- Uzzi et al., *Science* 2013, atypical reference combinations as a novelty signal. https://www.science.org/doi/10.1126/science.1240474
