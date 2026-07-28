import { useState, useRef, useEffect } from 'react'
import { Quote, Copy, Download, Check } from 'lucide-react'
import { bibtex, ris, citeKey } from '../lib/citation'

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const FORMATS = [
  { id: 'bibtex', label: 'BibTeX', ext: 'bib', mime: 'application/x-bibtex', gen: bibtex },
  { id: 'ris', label: 'RIS', ext: 'ris', mime: 'application/x-research-info-systems', gen: ris },
]

/**
 * CiteButton — a two-click citation export (Phase 9). Opens a small menu with
 * BibTeX and RIS, each offering copy-to-clipboard and a file download. The text
 * is generated from the stored record (src/lib/citation.js); nothing is scraped.
 */
export function CiteButton({ paper, variant = 'pill' }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const copy = async (fmt) => {
    try { await navigator.clipboard.writeText(fmt.gen(paper)); setCopied(fmt.id); setTimeout(() => setCopied(null), 1500) } catch { /* clipboard blocked */ }
  }
  const download = (fmt) => downloadText(`${citeKey(paper)}.${fmt.ext}`, fmt.gen(paper), fmt.mime)

  const toggle = e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }

  return (
    <div className="relative" ref={ref}>
      {variant === 'icon' ? (
        <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Cite this paper" title="Cite"
          className="shrink-0 p-1 rounded-sm text-muted/60 hover:text-accent transition-colors">
          <Quote className="w-4 h-4" />
        </button>
      ) : (
        <button onClick={toggle} aria-haspopup="menu" aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-[13px] font-sans font-medium px-3 py-1.5 rounded-full border border-rule text-ink-soft hover:border-accent hover:text-accent transition-colors">
          <Quote className="w-3.5 h-3.5" /> Cite
        </button>
      )}
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1.5 w-56 bg-paper border border-rule rounded-sm shadow-lg p-1.5">
          {FORMATS.map(fmt => (
            <div key={fmt.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm hover:bg-canvas">
              <span className="text-[13px] font-sans font-medium text-ink">{fmt.label}</span>
              <span className="flex items-center gap-1">
                <button onClick={() => copy(fmt)} className="inline-flex items-center gap-1 text-[12px] font-sans text-accent hover:underline" aria-label={`Copy ${fmt.label}`}>
                  {copied === fmt.id ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
                <button onClick={() => download(fmt)} className="p-1 text-muted hover:text-accent" aria-label={`Download ${fmt.label}`} title="Download">
                  <Download className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
