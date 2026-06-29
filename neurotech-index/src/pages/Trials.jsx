import { useState, useEffect } from 'react'
import { FlaskConical } from 'lucide-react'
import { getTrials } from '../lib/data'
import { NeuralBackground, PageHeader, Loader, EmptyState } from '../components/ui'
import { EntryCard, DetailPanel } from '../components/entries'

export default function Trials() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let alive = true
    getTrials().then(d => { if (alive) { setItems(d); setLoading(false) } })
    return () => { alive = false }
  }, [])

  return (
    <div className="relative">
      <NeuralBackground className="h-72" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          eyebrow="ClinicalTrials.gov"
          title="Clinical Trials"
          sub="Active and completed neurotechnology trials — sponsors, phases, interventions, and the devices and papers they connect to."
        />
        {loading ? (
          <Loader />
        ) : items.length === 0 ? (
          <EmptyState icon={FlaskConical} title="Trials ingestion is being wired up">
            This section connects to ClinicalTrials.gov as part of the current build phase. Once the
            daily pipeline includes it, neurotech trials will appear here automatically.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((t, i) => <EntryCard key={i} entry={t} onClick={() => setSelected(t)} />)}
          </div>
        )}
      </div>
      {selected && <DetailPanel entry={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
