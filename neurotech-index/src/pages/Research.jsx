import BrowseList from '../components/BrowseList'
import { getPapers } from '../lib/data'

export default function Research() {
  return (
    <BrowseList
      eyebrow="Peer-reviewed & preprints"
      title="Research"
      sub="Papers and preprints across neurotechnology, each tagged to the topic taxonomy. AI summaries lead; original sources are one click away."
      loader={getPapers}
      showAxes={['application', 'stage']}
    />
  )
}
