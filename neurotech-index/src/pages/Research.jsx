import NewsSection from '../components/NewsSection'

const RESEARCH = ['paper', 'preprint']

export default function Research() {
  return (
    <NewsSection
      kicker="Research"
      title="Papers & Preprints"
      sub="Peer-reviewed papers and preprints, with AI summaries and citation impact."
      entryTypes={RESEARCH}
      lead
    />
  )
}
