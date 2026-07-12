import DirectorySection from '../components/DirectorySection'
import { getDevices } from '../lib/data'

export default function Devices() {
  return (
    <DirectorySection
      kicker="Devices"
      title="Devices & Technologies"
      sub="Neurotechnology hardware and platforms, from invasive implants to consumer headsets."
      loader={getDevices}
    />
  )
}
