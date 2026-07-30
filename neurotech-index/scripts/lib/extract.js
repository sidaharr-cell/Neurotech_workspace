/**
 * extract.js — the extraction pass. Spec section 7.2, Phase 3.
 *
 * Separates what an item CLAIMS from what it DEMONSTRATES, before any scoring
 * happens. Spec section 7: "the claim-versus-demonstration separation is the
 * control the entire anti-hype design rests on, and it is materially more
 * reliable when extraction happens before scoring."
 *
 * This module extracts. It does not score, rank, or judge importance. The prompt
 * says so explicitly and the tool schema gives it nowhere to put an opinion.
 *
 * TWO RULES SHAPE THE DESIGN.
 *
 * 1. REGISTRY FACTS ARE NOT ASKED OF THE MODEL. A trial's registration state,
 *    randomisation, comparator, blinding, primary endpoint and sponsor class are
 *    recorded fields, already ingested into news_feed.metadata.design by
 *    scripts/lib/trial-design.js. Asking a model to re-derive them from prose
 *    would invent disagreement with data we hold. Only `powered` and
 *    `null_interpretable` go to the model, because the registry does not state
 *    them, and they are handed the registry facts to reason from.
 *
 * 2. GRANULARITY IS RECORDED, NEVER ASSUMED. Every extraction carries the
 *    `input_granularity` it was produced from. Phase 3 acceptance requires that
 *    `demonstrated` never contain content absent from the source, and an
 *    abstract-only extraction that later gets full text must be re-runnable
 *    without ambiguity about why it changed. See
 *    docs/potential-impact-input-granularity.md.
 */

export const EXTRACTOR_VERSION = 'extract-1.0'

/** What the scorer was actually given. Ordered weakest to strongest. */
export const GRANULARITIES = ['metadata', 'abstract', 'registry', 'full_text']

export const EXTRACTION_TOOL = {
  name: 'record_extraction',
  description: 'Record what the item claims and what its disclosed evidence supports.',
  input_schema: {
    type: 'object',
    properties: {
      claimed: {
        type: 'string',
        description: 'What the item asserts is possible, achieved, planned, or implied. Use the item\'s own framing.',
      },
      demonstrated: {
        type: ['string', 'null'],
        description: 'What the item\'s disclosed evidence actually supports. For a trial, what the pre-specified design is capable of establishing. Null if no evidence is disclosed.',
      },
      quantitative_results: {
        type: 'array',
        description: 'Only values the item reports. Do not infer or convert.',
        items: {
          type: 'object',
          properties: {
            metric: { type: 'string' },
            value: { type: 'string' },
            units: { type: 'string' },
            conditions: { type: 'string' },
          },
          required: ['metric', 'value', 'units'],
        },
      },
      methods_disclosed: {
        type: 'boolean',
        description: 'Are methods described in enough detail for an independent group to assess the claim.',
      },
      artifacts_released: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'weights, dataset, hardware design, protocol, code' },
            terms: { type: 'string', description: 'Licence or access terms as stated, or "not stated".' },
            url: { type: ['string', 'null'] },
          },
          required: ['type', 'terms'],
        },
      },
      constraints_addressed: {
        type: 'array',
        description: 'Only constraints the item explicitly names or clearly implies.',
        items: {
          type: 'object',
          properties: {
            constraint: { type: 'string' },
            who_else_is_blocked: {
              type: ['string', 'null'],
              description: 'A named party other than the authors, or null. Null is correct when the item names nobody.',
            },
          },
          required: ['constraint', 'who_else_is_blocked'],
        },
      },
      rhetorical_markers: {
        type: 'array', items: { type: 'string' },
        description: 'Superlative or novelty terms used. Recorded for monitoring only; never evidence.',
      },
    },
    required: ['claimed', 'demonstrated', 'quantitative_results', 'methods_disclosed',
      'artifacts_released', 'constraints_addressed', 'rhetorical_markers'],
  },
}

/** Only the two fields the registry cannot state. Trials only. */
export const TRIAL_INFERENCE_TOOL = {
  name: 'record_trial_inference',
  description: 'Record only what the registration does not state outright.',
  input_schema: {
    type: 'object',
    properties: {
      powered: {
        type: ['boolean', 'null'],
        description: 'Does the record state the trial is powered for its primary endpoint. Null when it says nothing either way.',
      },
      null_interpretable: {
        type: ['boolean', 'null'],
        description: 'Would a null result be interpretable, i.e. would it close the question rather than leave it ambiguous. This requires an adequate comparator and a pre-specified endpoint. Null when there is not enough to say.',
      },
      reasoning: { type: 'string', description: 'One sentence, citing the design facts given.' },
    },
    required: ['powered', 'null_interpretable', 'reasoning'],
  },
}

export const EXTRACTION_PROMPT = `You are extracting factual content from a
neurotechnology record for downstream scoring. Do not evaluate importance. Do not
summarize persuasively. Do not rank, rate, or praise.

  claimed: What the item asserts is possible, achieved, planned, or implied.
    Use the item's own framing, including its overstatement if it overstates.
  demonstrated: What the item's disclosed evidence actually supports. For a
    trial, what the pre-specified design is capable of establishing. If no
    evidence is disclosed, return null. Do NOT repair a weak claim into a
    stronger one, and do NOT put anything here that is not in the source.
  quantitative_results: Only values the item reports. Do not infer or convert.
    If a number appears with no units, omit it.
  methods_disclosed: Could an independent group assess the claim from what is
    described.
  artifacts_released: Weights, datasets, hardware designs, protocols, code.
    Record the terms as stated; "not stated" is a valid answer.
  constraints_addressed: Only constraints the item explicitly names or clearly
    implies. who_else_is_blocked must be a named party OTHER than the authors,
    or null. Null is the correct answer when the item names nobody. Do not
    invent a beneficiary.
  rhetorical_markers: The superlative or novelty terms used. These are recorded
    for monitoring and are never evidence of anything.

The single most important rule: claimed and demonstrated must be allowed to
differ. If the item announces a capability and shows data for a weaker one, say
the weaker one in demonstrated. That divergence is the point of this step.
{entity_note}
Item type: {entity_type}
Available input: {granularity}

Item:
---
{content}
---`

export const TRIAL_INFERENCE_PROMPT = `A clinical trial registration states the
design facts below. Two things it does not state outright, which you must assess
from those facts alone.

  powered: does the registration indicate the trial is powered for its primary
    endpoint. Most registrations say nothing; null is then correct.
  null_interpretable: would a null result close the question rather than leave
    it ambiguous. This needs an adequate comparator AND a pre-specified primary
    endpoint. A single-arm trial with no comparator is not interpretable under a
    null. Null when there is not enough to say.

Do not judge whether the trial is important or worthwhile. Only these two.

Registration facts:
{design}

Enrollment: {enrollment}
Brief summary:
---
{summary}
---`

/**
 * Entity-specific notes appended to the extraction prompt.
 *
 * The trial note exists because of a measured failure. Without it the model read
 * "has not reported results yet" as "demonstrates nothing" and returned null for
 * 4 of 6 sampled trials, which is the opposite of what spec 7.2 asks for: for a
 * trial, `demonstrated` is what the PRE-SPECIFIED DESIGN is capable of
 * establishing. A registered trial with an endpoint and a comparator has
 * established what question it can answer, whether or not it has answered it.
 * Getting this wrong also spuriously fired gap_flagged on every unreported
 * trial, which would have turned the anti-hype control into noise.
 */
export const ENTITY_NOTES = {
  trial: `
FOR A TRIAL: demonstrated is NOT "what results exist". A trial that has not
reported has still, through its registered design, fixed what it is CAPABLE of
establishing. Describe that: the question its pre-specified primary endpoint and
its comparator can answer, in which population, and what a null result would
mean. Return null ONLY when the registration lacks an endpoint or enough design
detail to say what it could establish. "No results posted yet" is not a reason
to return null.`,
  device: `
FOR A DEVICE: the unit of impact is the capability the device makes routinely
available, not a one-off demonstration. A regulatory listing or product
description usually demonstrates nothing on its own; null is then correct and
expected.`,
  feed: `
FOR A NEWS OR ANNOUNCEMENT ITEM: an announcement without released data
demonstrates nothing. Null is correct and expected. Do not treat a company's
description of its own results as evidence of them.`,
  research: '',
}

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * The trial_design block for an ImpactScore, spec 3.2.
 * Everything except `powered` and `null_interpretable` is copied from the
 * registration; those two are the model's, and null when it could not say.
 */
export function trialDesignFrom(metadata, inference = null) {
  const d = metadata?.design
  if (!d) return null
  return {
    registered: !!d.registrationDate,
    registry_id: metadata.nctId || null,
    randomized: d.allocation === 'RANDOMIZED',
    comparator: d.hasControlArm ? (d.hasShamArm ? 'sham' : d.hasPlaceboArm ? 'placebo' : 'active or none') : null,
    blinding: d.masking || null,
    who_masked: d.whoMasked || [],
    primary_endpoint: d.primaryOutcomes?.[0]?.measure || null,
    prespecified: !!d.hasPrespecifiedPrimary,
    powered: inference?.powered ?? null,
    null_interpretable: inference?.null_interpretable ?? null,
    status: metadata.status || null,
    sponsor_type: metadata.sponsorClass || null,
    // Which fields came from the registry rather than from a model.
    registry_sourced: ['registered', 'registry_id', 'randomized', 'comparator',
      'blinding', 'who_masked', 'primary_endpoint', 'prespecified', 'status', 'sponsor_type'],
  }
}

/**
 * The text handed to the extractor, and the granularity that text represents.
 * Returns null when there is nothing substantive to extract from, which is a
 * real outcome and not an error.
 */
export function inputFor(item, entityType) {
  if (entityType === 'trial') {
    const m = item.metadata || {}
    const parts = [item.title, m.design?.primaryOutcomes?.map(o => `Primary endpoint: ${o.measure}. ${o.description || ''}`).join(' '), item.summary]
    const content = parts.filter(Boolean).map(clean).join('\n\n')
    return content ? { content, granularity: 'registry' } : null
  }
  const body = item.abstract || item.summary || item.description || ''
  const content = [item.title, body].filter(Boolean).map(clean).join('\n\n')
  if (!content) return null
  // Nothing in this corpus is full text yet; see the input-granularity doc.
  return { content, granularity: body.length > 200 ? 'abstract' : 'metadata' }
}

/** Normalize a tool payload into the stored shape, coercing stringified arrays. */
export function shapeExtraction(input) {
  const arr = v => {
    if (Array.isArray(v)) return v
    if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
    return []
  }
  const dem = input?.demonstrated
  return {
    claimed: clean(input?.claimed) || null,
    demonstrated: dem == null || clean(dem) === '' ? null : clean(dem),
    quantitative_results: arr(input?.quantitative_results)
      .filter(r => r && r.metric && r.value != null && r.units)
      .map(r => ({ metric: clean(r.metric), value: clean(r.value), units: clean(r.units), conditions: clean(r.conditions) || null })),
    methods_disclosed: !!input?.methods_disclosed,
    artifacts_released: arr(input?.artifacts_released)
      .filter(a => a && a.type)
      .map(a => ({ type: clean(a.type), terms: clean(a.terms) || 'not stated', url: a.url || null })),
    constraints_addressed: arr(input?.constraints_addressed)
      .filter(c => c && c.constraint)
      .map(c => ({ constraint: clean(c.constraint), who_else_is_blocked: clean(c.who_else_is_blocked) || null })),
    rhetorical_markers: arr(input?.rhetorical_markers).map(clean).filter(Boolean),
  }
}

/**
 * Does `claimed` materially exceed `demonstrated`? Deterministic, per spec 8
 * rule 8. Runs as code because it is a check ON the model, not a request to it.
 *
 * Deliberately conservative: it flags the cases the anti-hype control exists
 * for, rather than trying to adjudicate every shade of overstatement.
 */
export function gapFlagged(e, entityType = null) {
  if (!e) return false
  // Nothing demonstrated at all, but something claimed, is the clearest case
  // and it holds for every entity type.
  if (!e.demonstrated && e.claimed) return true

  // A TRIAL is exempt from the evidence-behind-the-claim test. A registered
  // trial has reported nothing yet BY DEFINITION, so "no methods, no numbers"
  // describes every well-designed trial that has not read out. Applying it
  // flagged 6 of 8 sampled trials and would have made the flag meaningless
  // exactly where the design-quality grade (spec 5.3.2) is the real control.
  if (entityType === 'trial') return false

  // A claim with no disclosed evidence and no numbers behind it.
  if (!e.methods_disclosed && !e.quantitative_results.length && e.claimed) return true
  return false
}
