import BrowseList from '../components/BrowseList'
import { getDevices } from '../lib/data'

export default function Devices() {
  return (
    <BrowseList
      eyebrow="Hardware & platforms"
      title="Devices & Technologies"
      sub="From invasive implants to consumer headsets — filter by modality, application, and development stage."
      loader={getDevices}
      showAxes={['modality', 'application', 'stage']}
    />
  )
}
