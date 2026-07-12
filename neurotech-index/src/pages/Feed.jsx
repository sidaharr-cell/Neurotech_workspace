import NewsSection from '../components/NewsSection'

export default function Feed() {
  return (
    <NewsSection
      kicker="Updated daily"
      title="Top Stories"
      sub="The most significant neurotechnology — research, devices, and coverage — ranked by relevance, engagement, and recency."
      entryTypes={null}
      lead
    />
  )
}
