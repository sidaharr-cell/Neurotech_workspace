/**
 * seed.js — one-time script to populate Supabase with the existing JSON data.
 * Run once after creating the schema: npm run seed
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '../src/data')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function load(file) {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
}

async function seed() {
  console.log('🌱 Seeding Supabase with existing JSON data...\n')

  const papers = load('papers.json')
  const devices = load('devices.json')
  const organizations = load('organizations.json')
  const researchers = load('researchers.json')

  // Papers
  const { error: pErr } = await supabase.from('papers').upsert(
    papers.map(p => ({
      title: p.title,
      authors: p.authors,
      journal: p.journal,
      year: p.year,
      doi: p.doi || null,
      url: p.url || null,
      abstract: p.abstract || null,
      tags: p.tags || [],
      source: 'manual',
    })),
    { onConflict: 'doi', ignoreDuplicates: true }
  )
  if (pErr) console.error('Papers error:', pErr.message)
  else console.log(`✓ Seeded ${papers.length} papers`)

  // Devices
  const { error: dErr } = await supabase.from('devices').upsert(
    devices.map(d => ({
      name: d.name,
      manufacturer: d.manufacturer,
      type: d.type,
      year: d.year,
      status: d.status || null,
      signal_type: d.signalType || null,
      channels: d.channels || null,
      description: d.description || null,
      modality: d.modality || [],
      tags: d.tags || [],
      url: d.url || null,
    }))
  )
  if (dErr) console.error('Devices error:', dErr.message)
  else console.log(`✓ Seeded ${devices.length} devices`)

  // Organizations
  const { error: oErr } = await supabase.from('organizations').upsert(
    organizations.map(o => ({
      name: o.name,
      type: o.type,
      location: o.location,
      founded: o.founded || null,
      description: o.description || null,
      focus_areas: o.focusAreas || [],
      website: o.website || null,
      founders: o.founders || [],
    }))
  )
  if (oErr) console.error('Organizations error:', oErr.message)
  else console.log(`✓ Seeded ${organizations.length} organizations`)

  // Researchers
  const { error: rErr } = await supabase.from('researchers').upsert(
    researchers.map(r => ({
      name: r.name,
      affiliation: r.affiliation,
      role: r.role || null,
      bio: r.bio || null,
      expertise: r.expertise || [],
      notable_work: r.notableWork || [],
    }))
  )
  if (rErr) console.error('Researchers error:', rErr.message)
  else console.log(`✓ Seeded ${researchers.length} researchers`)

  console.log('\n✅ Seed complete. Your Supabase database is ready.')
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment.')
  process.exit(1)
}

seed().catch(console.error)
