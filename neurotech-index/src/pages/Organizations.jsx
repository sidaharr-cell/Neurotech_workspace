import BrowseList from '../components/BrowseList'
import { getOrganizations } from '../lib/data'

export default function Organizations() {
  return (
    <BrowseList
      eyebrow="Labs · companies · hospitals"
      title="Organizations"
      sub="The academic labs, companies, and consortia building neurotechnology."
      loader={getOrganizations}
      showAxes={['application']}
    />
  )
}
