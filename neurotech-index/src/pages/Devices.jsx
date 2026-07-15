import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Cpu, ChevronLeft, ChevronRight } from 'lucide-react'
import { searchDevices } from '../lib/data'
import { SectionHeading, Loader, EmptyState } from '../components/ui'
import { EntityRow, DetailPanel } from '../components/Directory'
import DeviceClassFilter from '../components/DeviceClassFilter'

const PAGE_SIZE = 20

export default function Devices() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [cls, setCls] = useState(null)
  const [page, setPage] = useState(0)
  const [{ rows, total }, setResult] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const debounce = useRef(null)

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setQuery(input); setPage(0) }, 350)
    return () => clearTimeout(debounce.current)
  }, [input])
  useEffect(() => { setPage(0) }, [cls])

  const load = useCallback(async () => {
    setLoading(true)
    setResult(await searchDevices({ query, deviceClass: cls, page, pageSize: PAGE_SIZE }))
    setLoading(false)
  }, [query, cls, page])
  useEffect(() => { load() }, [load])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <SectionHeading
        kicker="Devices"
        title="Devices & Technologies"
        sub="A searchable index of FDA-cleared and approved neurotechnology devices, plus notable investigational hardware."
        right={<span className="font-sans text-[13px] text-muted whitespace-nowrap">{total.toLocaleString()} devices</span>}
      />

      <div className="relative max-w-2xl mb-6">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search devices and manufacturers…"
          className="w-full pl-8 pr-4 py-2.5 bg-transparent border-b border-rule text-ink font-serif text-xl placeholder:text-muted/50 focus:outline-none focus:border-ink transition-colors" />
      </div>

      <DeviceClassFilter value={cls} onChange={setCls} />

      {loading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState icon={Cpu} title="No devices found">Try different terms or clear the device-class filter.</EmptyState>
      ) : (
        <>
          <div className="max-w-4xl divide-rule">
            {rows.map((d, i) => <EntityRow key={d.id || i} entity={d} onClick={() => setSelected(d)} />)}
          </div>
          {pages > 1 && (
            <div className="max-w-4xl flex items-center justify-between mt-8 pt-5 border-t border-rule">
              <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 text-[13px] font-sans text-ink disabled:text-muted/40 disabled:cursor-not-allowed hover:text-accent transition-colors">
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-[13px] font-sans text-muted">Page {page + 1} of {pages.toLocaleString()}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}
                className="inline-flex items-center gap-1 text-[13px] font-sans text-ink disabled:text-muted/40 disabled:cursor-not-allowed hover:text-accent transition-colors">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
      {selected && <DetailPanel entity={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
