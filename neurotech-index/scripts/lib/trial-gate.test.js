import { describe, it, expect } from 'vitest'
import { onTopicTrial, trialTags, trialHaystack, TRIAL_NEUROTECH } from './trial-gate.js'

/**
 * Every KEEP case here is a real ClinicalTrials.gov record an earlier version of
 * this gate deleted, and every DROP case is one an earlier version kept. A gate
 * is only as good as the mistakes it remembers.
 */
const trial = (title, over = {}) => ({ title, summary: '', interventions: [], conditions: [], topics: [], ...over })

describe('onTopicTrial — keeps', () => {
  it('keeps the plainly neurotech trial', () => {
    expect(onTopicTrial(trial('Deep Brain Stimulation for Treatment-Resistant Depression'))).toBe(true)
    expect(onTopicTrial(trial('A Brain-Computer Interface for Communication in ALS'))).toBe(true)
  })

  it('keeps stimulation trials that carry no device-class tag', () => {
    // 352 trials in the index are in scope on the lexicon alone; a tag-only
    // gate deletes every one of them.
    for (const t of [
      'Ultra-Distal TENS Device for Restless Legs',
      'Evaluation of a Non-Implanted Electrical Stimulation Device for Overactive Bladder',
      'Non-invasive VNS for Parkinson\'s Gait',
      'tSCS and 5-Azacitidine for Enhanced Motor Outcomes in Cerebral Palsy',
      'PNS to Improve Vascular Function and Limb Health in Veterans',
    ]) expect(onTopicTrial(trial(t)), t).toBe(true)
  })

  it('keeps theta-burst protocols, which never say TMS', () => {
    expect(onTopicTrial(trial('Accelerated vs. Conventional Theta Burst Stimulation for Late-life Depression'))).toBe(true)
    expect(onTopicTrial(trial('Effect of aiTBS on Intrinsic Spectral Dynamics and Task Performance'))).toBe(true)
  })

  it('keeps DBS named by its target rather than by name', () => {
    expect(onTopicTrial(trial('Predictive Factors and Subthalamic Stimulation in Parkinson\'s Disease'))).toBe(true)
    expect(onTopicTrial(trial('Combined Stimulation of STN and SNr for Freezing of Gait'))).toBe(true)
  })

  it('keeps nerve pacing of the diaphragm', () => {
    expect(onTopicTrial(trial('Diaphragm Pacing in Individuals With Spinal Cord Injuries'))).toBe(true)
    expect(onTopicTrial(trial('Diaphragmatic Pacemaker in Tetraplegic Patients'))).toBe(true)
  })

  it('reads the intervention and condition fields, not just the title', () => {
    // The registry routinely names the device only in the intervention arm.
    const t = trial('Optimizing Extended-Duration Therapy for Restless Legs Syndrome (RLS)', {
      interventions: ['Tonic Motor Activation (TOMAC) Therapy'],
    })
    expect(TRIAL_NEUROTECH.test(trialHaystack(t))).toBe(true)
    expect(onTopicTrial(t)).toBe(true)
  })

  it('keeps a device whose record names the brand and no modality', () => {
    expect(onTopicTrial(trial('MyndMove Therapy for Severe Hemiparesis of the Upper Limb'))).toBe(true)
    expect(onTopicTrial(trial('ReActiv8 Post Market Surveillance Registry', {
      interventions: ['ReActiv8 Implantable Stimulation System'],
    }))).toBe(true)
  })

  it('keeps neuro prosthetics without keeping dental ones', () => {
    expect(onTopicTrial(trial('Neuromotor Prosthetic to Treat Stroke-Related Paresis'))).toBe(true)
    expect(onTopicTrial(trial('Cognitive-based Prosthetics to Improve Grasp and Reaching After SCI'))).toBe(true)
    expect(onTopicTrial(trial('Impact of Soft Tissue Grafts on Tissue Alterations After Immediate Tooth Replacement'))).toBe(false)
  })

  it('lets the lexicon overrule an off-topic family', () => {
    // Matches "breast implant" and is still neurotechnology.
    expect(onTopicTrial(trial('A Bionic Breast Project Using Neuroprosthesis to Reduce Chronic Pain After Mastectomy'))).toBe(true)
  })
})

describe('onTopicTrial — drops', () => {
  it('drops the trial that started this: a knee study whose only match was CBT', () => {
    expect(onTopicTrial(trial('A Multidisciplinary Intervention in Total Knee Arthroplasty', {
      interventions: ['Osteoarthritis education, exercise and CBT', 'Total Knee Arthroplasty'],
      conditions: ['Osteoarthritis; Primary', 'Degenerative Joint Disease of Knee'],
    }))).toBe(false)
  })

  it('drops ophthalmology that borrowed the word "implant"', () => {
    for (const t of [
      'Dexamethasone Intravitreal Implant in Retinal Vein Occlusion',
      'Study to Evaluate Long-Term Safety of Intravitreal OTX-TKI (Axitinib Implant)',
      'Extension Study for the Port Delivery System With Ranibizumab (Portal)',
    ]) expect(onTopicTrial(trial(t)), t).toBe(false)
  })

  it('drops an intravitreal trial even when a device-class tag matched', () => {
    // "retinal" is a device-class match string, so these arrived tagged and were
    // kept on that alone — 73 of them — until the off-topic family could
    // overrule a tag. The tag is incidental; the trial is ophthalmology.
    const t = trial('Ozurdex With Rescue Lucentis for Macular Edema Secondary to Retinal Vein Occlusion', {
      interventions: ['Dexamethasone intravitreal implant'],
      topics: ['sensory-restoration'],
    })
    expect(trialTags(t).length).toBeGreaterThan(0)
    expect(onTopicTrial(t)).toBe(false)
  })

  it('drops the other specialities that matched a neurotech search term', () => {
    for (const t of [
      'Remimazolam Versus Dexmedetomidine for Sedation During Neuraxial Anesthesia',
      'Hyaluronic Acid vs I-PRF With Microneedling in Enhancing Peri-implant Soft Tissue',
      'Carbetocin Monotherapy Versus Carbetocin Plus Oxytocin in Elective Cesarean Delivery',
      'Quality of Recovery in Laparoscopic Sleeve Gastrectomy Using Dexmedetomidine Infusion',
    ]) expect(onTopicTrial(trial(t)), t).toBe(false)
  })

  it('drops focused ultrasound outside a neuro target', () => {
    expect(onTopicTrial(trial('High-Intensity Focused Ultrasound for Uterine Fibroids'))).toBe(false)
    expect(onTopicTrial(trial('Focused Ultrasound Thalamotomy for Essential Tremor'))).toBe(true)
  })

  it('drops a drug trial for a neurological condition', () => {
    // A neurology trial is not a neurotechnology trial; the index is of devices.
    expect(onTopicTrial(trial('Efficacy and Safety of Latrepirdine in Patients With Alzheimer Type Dementia'))).toBe(false)
  })
})

describe('onTopicTrial — inputs', () => {
  it('accepts tags computed by the caller at ingest', () => {
    const t = trial('Something With No Signal At All')
    expect(onTopicTrial(t, ['neural-interfaces'])).toBe(true)
    expect(onTopicTrial(t, [])).toBe(false)
  })

  it('reads metadata.interventions for a stored row', () => {
    expect(onTopicTrial({ title: 'A Study', metadata: { interventions: ['Vagus Nerve Stimulation'] } })).toBe(true)
  })

  it('survives a record with nothing in it', () => {
    expect(onTopicTrial({ title: '' })).toBe(false)
    expect(onTopicTrial({})).toBe(false)
  })
})
