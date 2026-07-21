/**
 * backfill-patents-bq.js — comprehensive neurotech patent index from the Google
 * Patents public dataset on BigQuery (patents-public-data). Robust and free-tier
 * friendly: filters by the neurotech CPC classes, US granted patents only, and
 * selects only small columns (no abstract) to keep bytes-scanned low.
 *
 * Setup (one time):
 *   1. Create a free Google Cloud project; enable the BigQuery API.
 *   2. Create a service account with role "BigQuery Job User"; download its JSON key.
 *   3. npm install @google-cloud/bigquery
 *   4. In .env set: GCP_PROJECT_ID=your-project  and
 *      GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/key.json
 *
 *   node --env-file=.env scripts/backfill-patents-bq.js
 *
 * Upserts into the same `patents` table as the other patent scripts.
 */
import { BigQuery } from '@google-cloud/bigquery'
import { createClient } from '@supabase/supabase-js'
import { DEVICE_CLASSES } from '../src/lib/taxonomy.js'
import { NEUROTECH_CPC } from './backfill-patents.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const deriveTags = text => {
  const h = (text || '').toLowerCase()
  return DEVICE_CLASSES.filter(c => c.match.some(m => h.includes(m))).map(c => c.id)
}
const fmtDate = n => {
  const s = String(n || '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}

// One LIKE per neurotech CPC prefix (dataset codes look like "A61N1/36").
const cpcLike = NEUROTECH_CPC.map(c => `c.code LIKE '${c}%'`).join(' OR ')

const SQL = `
  SELECT
    publication_number,
    (SELECT t.text FROM UNNEST(title_localized) t WHERE t.language = 'en' LIMIT 1) AS title,
    (SELECT a.name FROM UNNEST(assignee_harmonized) a LIMIT 1) AS assignee,
    grant_date,
    ARRAY(SELECT DISTINCT c.code FROM UNNEST(cpc) c WHERE ${cpcLike}) AS cpc_codes
  FROM \`patents-public-data.patents.publications\`
  WHERE country_code = 'US'
    AND grant_date > 0
    AND EXISTS (SELECT 1 FROM UNNEST(cpc) c WHERE ${cpcLike})
`

async function main() {
  if (!process.env.GCP_PROJECT_ID) { console.error('Set GCP_PROJECT_ID (and GOOGLE_APPLICATION_CREDENTIALS).'); process.exit(1) }
  const bq = new BigQuery({ projectId: process.env.GCP_PROJECT_ID })

  console.log('Running BigQuery (one scan of ~a few hundred GB, well within the 1 TB/month free tier)...')
  const [rows] = await bq.query({ query: SQL, location: 'US' })
  console.log(`  ${rows.length} neurotech patents returned`)

  const patents = rows
    .filter(r => r.publication_number && r.title)
    .map(r => ({
      patent_number: r.publication_number,
      title: r.title,
      abstract: null,
      assignee: r.assignee || null,
      grant_date: fmtDate(r.grant_date),
      cpc_codes: r.cpc_codes || [],
      tags: deriveTags(r.title),
      url: `https://patents.google.com/patent/${r.publication_number}`,
      source: 'bigquery',
    }))

  console.log(`Upserting ${patents.length} patents...`)
  let upserted = 0
  for (let i = 0; i < patents.length; i += 500) {
    const { error } = await supabase.from('patents').upsert(patents.slice(i, i + 500), { onConflict: 'patent_number', ignoreDuplicates: false })
    if (error && !error.message.includes('duplicate')) console.warn('upsert error:', error.message)
    else upserted += Math.min(500, patents.length - i)
  }
  console.log(`✓ BigQuery backfill complete — ${upserted} neurotech patents upserted.`)
}

main().catch(e => { console.error(e); process.exit(1) })
