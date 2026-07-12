import { useState, useEffect } from 'react'
import { FlaskConical } from 'lucide-react'
import { getTrials } from '../lib/data'
import { SectionHeading, Loader, EmptyState } from '../components/ui'

export default function Trials() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getTrials().then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Clinical Trials"
        title="Trials & Studies"
        sub="Active and completed neurotechnology trials — sponsors, phases, interventions, and the devices they test."
      />
      {loading ? (
        <Loader />
      ) : items.length === 0 ? (
        <EmptyState icon={FlaskConical} title="Trials ingestion is being wired up">
          This section will connect to ClinicalTrials.gov so neurotech trials appear here automatically.
        </EmptyState>
      ) : null}
    </div>
  )
}
