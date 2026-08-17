/**
 * resolve-founding-conflicts.js — settle `founded_conflict`, or say why it stands.
 *
 *   node --env-file=.env scripts/resolve-founding-conflicts.js            # dry run
 *   node --env-file=.env scripts/resolve-founding-conflicts.js --commit
 *
 * `founded_conflict` renders in the UI as a dagger meaning SOURCES DISAGREE.
 * Reading all 163 of them showed the field was doing three different jobs, and
 * only one of them is a disagreement:
 *
 *   1. A real disagreement, close. Two credible years a year apart, usually
 *      "started working" against "was registered". Both are cited and the
 *      dagger is exactly right. LEFT ALONE — that is the desired end state.
 *
 *   2. A real disagreement, far apart, WHERE THE NOTE ALREADY SETTLES IT. Most
 *      of these are not disputes at all but explanations of why other years
 *      exist and do not apply: an acquisition, a SPAC, a rename, a predecessor,
 *      a grant, a parent company. Boston Scientific Neuromodulation's note
 *      separates four years across four events. Leaving a dagger on those tells
 *      a reader the year is contested when the research concluded it is not.
 *      RESOLVED HERE: the reasoning moves into founded_evidence, where it is
 *      still visible, and the conflict is cleared.
 *
 *   3. No second year at all — a caveat about thin evidence that predates the
 *      applier learning to keep caveats out of this field. AGGREGATOR-ONLY is
 *      not a disagreement. MOVED to founded_evidence automatically.
 *
 * A fourth group is genuinely unresolved: the note says so in as many words
 * ("Unresolved", "Neither is resolved", "could not be resolved"). Those keep
 * their dagger. Picking a year there would be inventing a conclusion the
 * evidence does not support, and the whole sweep was built on not doing that.
 *
 * SIX ROWS CHANGE YEAR. Each is a case where the note argues for the year the
 * row does NOT hold — a parent's date on a subsidiary's row, a brand date on a
 * company row, a re-incorporation date where the business plainly predates it.
 */
import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')
const YEARS = /\b(1[89]\d\d|20[0-2]\d)\b/g

/**
 * Rows where the recorded reasoning settles the question.
 * `year` is present only where the STORED year is the wrong one of the two.
 */
const RESOLVED = [
  // ── the stored year stands; the other years belong to other events ────────
  { name: 'Headsafe', reason: 'Resolved to 2017: the 1987 "HeadSafe" was a concussion programme of the not-for-profit Necksafe Ltd, so the name predates the commercial MedTech entity by thirty years.' },
  { name: 'Bee Medic', reason: 'Resolved to 2005: EEG Spectrum (1988), EEG Info Inc (2003) and BEE Systems Switzerland (2004) are predecessors and affiliates, not the founding of BEE Medic GmbH.' },
  { name: 'Boston Scientific Neuromodulation Corporation', reason: 'Resolved to 1993, Advanced Bionics\' founding and the direct ancestor of this Valencia entity. 2004 is Boston Scientific\'s acquisition, 2008 the restructuring and rename, and 1979 is Boston Scientific Corporation\'s own founding, which belongs to a separate row.' },
  { name: 'Akili Interactive', reason: 'Resolved to 2011: the other dates are corporate events, not founding claims — the August 2022 SPAC listing as Akili Inc, and the Virtual Therapeutics tender offer completed 1 July 2024.' },
  { name: 'PENTAS', reason: 'Resolved to 2015: April 2025 is the exclusion from Allm\'s consolidated subsidiaries and the move into the GENARK group, a change of ownership rather than a founding.' },
  { name: 'Dreem', reason: 'Resolved to 2014: 2023 is Beacon Biosignals taking over Dreem R&D on 11 July, after which the headband shipped as Dreem 3S. An acquisition, not a founding.' },
  { name: 'Ornim Medical', reason: 'Resolved to 2004: the 2011 GE healthymagination and OrbiMed $20M event that dominates search results is a Series B, not a founding.' },
  { name: 'Newronika', reason: 'Resolved to 2008, the year sources tied to founder Alberto Priori give. 2016 is most likely the recapitalisation when Newronika became a venture-backed operating company, which is not a founding.' },
  { name: 'Brainjo', reason: 'Resolved to 2021: the company\'s own seed-round boilerplate saying 2022 refers to the UG-to-GmbH change of legal form of the same entity, not a founding.' },
  { name: 'Actipulse Neuroscience', reason: 'Resolved to 2017: the Delaware holding entity organised 27 June 2019, which acquired the Mexican company in a 2021 share swap, is a restructuring rather than a founding.' },
  { name: 'Lift Labs', reason: 'Resolved to 2010: 2011 is an NIH grant date and September 2014 the Google acquisition, after which Liftware moved to Verily. The January-1 day on the competing aggregator value is the tell that it was imported rather than sourced.' },
  { name: 'Nuro Corp', reason: 'Resolved to 2017, which the company itself labels the incorporation. The 2014 "first conceived in Waterloo" framing is an origin story rather than a founding.' },
  { name: 'Nordic Neurostim', reason: 'Resolved to 2016, the register\'s year, because the CVR number corroborates it independently: Danish numbers are issued roughly sequentially and the 38-prefix block corresponds to 2016-17, so the record and the identifier agree. The aggregators\' 2013 may reflect a predecessor entity or the AAU project start.' },
  { name: 'Swap', reason: 'Resolved to 2014: the competing 2016 traces to a November 2016 article by La Fabrique Hexagonale whose own publication year bled into the summary. The company\'s own page and several French outlets give 2014.' },
  { name: 'Lifelines Neurodiagnostic Systems', reason: 'Resolved to 2001 for this US entity. 2000 is when Simon Griffin left MEDICA and decided to start the business, which is pre-founding, and 1999 belongs to Lifelines Ltd of the UK, a separate earlier company.' },
  { name: 'BrainFx', reason: 'Resolved to 2012: the 2008 date on a ventureLAB profile is the Ontario occupational-therapy practice the founders ran beforehand, a predecessor practice rather than BrainFx.' },
  { name: 'AAVAA', reason: 'Resolved to 2019: BetaKit\'s 2021 reads as commercial launch and the CEO\'s arrival rather than formation.' },
  { name: 'GAIA', reason: 'Resolved to 1997: the 2001 in a German life-sciences directory is most likely an entity registration year.' },
  { name: 'Oscillo Biosciences', reason: 'Resolved to 2017: the SBIR.gov awards running back to 2007 appear mis-merged from another of the founder\'s ventures and do not belong to this company.' },
  { name: 'Healing Hand Tech', reason: 'Resolved to 2020: the company\'s own 2023 release states 2020, agreeing with Crunchbase against Tracxn\'s 2018. It may still be an incorporation date rather than the start of the venture.' },

  // ── the stored year was the wrong one of the two ──────────────────────────
  { name: 'Pajunk Medical Systems', year: 2001,
    reason: 'Changed from 1965 to 2001. 1965 is the GERMAN PARENT, PAJUNK GmbH; this row is the US subsidiary PAJUNK Medical Systems LP of Norcross, Georgia. A parent\'s founding does not belong on a subsidiary\'s row.' },
  { name: 'Restore', year: 2010,
    reason: 'Changed from 2018 to 2010. RESTORE-Skills is the adult-rehab product line of the Israeli company Timocco, founded in 2010, with a US headquarters in Akron from 2015. 2018 is a brand or spin-out date, not the company\'s founding.' },
  { name: 'Impact Applications Inc.', year: 1994,
    reason: 'Changed from 2002 to 1994. 1994 is when the predecessor company Neurohealth was established, which is when the business came into existence; 2002 is the re-incorporation and rename, and a rename is explicitly not a founding.' },
  { name: 'Molecular NeuroImaging', year: 2001,
    reason: 'Changed from 2000 to 2001 on the company\'s own earlier Founders page, which says the team united in March 2001 to form Molecular NeuroImaging LLC and notes that Marek was at Yale until March 2001.' },
  { name: 'KM Medical Software', year: 2005,
    reason: 'Changed from 2007 to 2005. Mahalingam and his wife Mary started the business in Cork in 2005; 2007 is incorporation, and under the rule this sweep has applied throughout, incorporation is not a founding. An Irish CRO filing would confirm it.' },
  { name: 'Novela Neuro', year: 2013,
    reason: 'Changed from 2018 to 2013, the year Medical Tech Outlook records the company as incorporated, as a spin-off from Canadian universities and SickKids. R&D began in 2007, which is a research date, not a founding.' },
]

async function run() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const all = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('organizations')
      .select('id,name,founded_year,founded_evidence,founded_conflict,inclusion_decision')
      .eq('type', 'company').not('founded_conflict', 'is', null).order('id').range(from, from + 499)
    if (error) { console.error('read failed:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < 500) break
  }
  // `.neq('inclusion_decision','exclude')` cannot do this: NULL != 'exclude' is
  // NULL, not true, so PostgREST would drop every undecided row — which is most
  // of the table. Filter in JS where null means what it plainly means.
  const rows = all.filter(r => r.inclusion_decision !== 'exclude')

  const byName = new Map(rows.map(r => [r.name, r]))
  const writes = []

  for (const d of RESOLVED) {
    const r = byName.get(d.name)
    if (!r) { console.error(`  ! no surviving row named "${d.name}"`); process.exitCode = 1; continue }
    writes.push({
      id: r.id, name: r.name, kind: d.year ? 'year changed' : 'adjudicated',
      from: r.founded_year, to: d.year ?? r.founded_year,
      cols: {
        ...(d.year ? { founded_year: d.year } : {}),
        founded_evidence: [r.founded_evidence, d.reason].filter(Boolean).join(' '),
        founded_conflict: null,
      },
    })
  }

  // The misfiled caveats: a conflict string naming no year other than the one
  // already stored is not a disagreement, whatever it says.
  const decided = new Set(RESOLVED.map(d => d.name))
  const stillUnresolved = []
  for (const r of rows) {
    if (decided.has(r.name)) continue
    const others = [...new Set((r.founded_conflict.match(YEARS) || []).map(Number))]
      .filter(y => y !== r.founded_year)
    if (!others.length) {
      writes.push({
        id: r.id, name: r.name, kind: 'caveat moved', from: r.founded_year, to: r.founded_year,
        cols: {
          founded_evidence: [r.founded_evidence, `Caveat: ${r.founded_conflict}`].filter(Boolean).join(' '),
          founded_conflict: null,
        },
      })
      continue
    }
    const span = Math.max(...others.map(y => Math.abs(y - r.founded_year)))
    if (span > 1) stillUnresolved.push(`${r.name} (${r.founded_year} vs ${others.join('/')})`)
  }

  const tally = {}
  for (const w of writes) tally[w.kind] = (tally[w.kind] || 0) + 1
  console.log(`${all.length} rows carry a conflict; ${rows.length} of them survive in the index`)
  console.log(`${writes.length} to change: ${JSON.stringify(tally)}`)
  for (const w of writes.filter(w => w.kind === 'year changed')) {
    console.log(`  ${w.name}: ${w.from} -> ${w.to}`)
  }
  console.log(`\n${stillUnresolved.length} conflicts stand, because the evidence does not settle them:`)
  for (const s of stillUnresolved) console.log(`  ${s}`)

  if (!COMMIT) { console.log('\nDry run. Re-run with --commit.'); return }
  let done = 0
  const failures = []
  for (const w of writes) {
    const { error } = await sb.from('organizations').update(w.cols).eq('id', w.id)
    if (error) failures.push(`${w.name}: ${error.message}`)
    else done++
  }
  console.log(`\nUpdated ${done} of ${writes.length}.`)
  if (failures.length) { console.error(failures.map(f => `  ${f}`).join('\n')); process.exit(1) }
}

run().catch(e => { console.error(e); process.exit(1) })
