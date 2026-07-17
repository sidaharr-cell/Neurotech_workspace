import NewsSection from '../components/NewsSection'

const NEWS = ['news']

export default function Media() {
  return (
    <NewsSection
      kicker="Media"
      title="News & Press"
      sub="Worldwide neurotechnology coverage from press and media outlets."
      entryTypes={NEWS}
      lead
      emptyHint="Media items populate from the daily press-feed ingestion."
    />
  )
}
