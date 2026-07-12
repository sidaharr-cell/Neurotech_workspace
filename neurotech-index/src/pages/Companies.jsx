import DirectorySection from '../components/DirectorySection'
import { getOrganizations } from '../lib/data'

export default function Companies() {
  return (
    <DirectorySection
      kicker="Companies"
      title="Companies & Institutes"
      sub="The labs, companies, and consortia building neurotechnology."
      loader={getOrganizations}
    />
  )
}
