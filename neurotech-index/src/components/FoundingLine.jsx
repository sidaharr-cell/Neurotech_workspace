import { Calendar } from 'lucide-react'
import { foundingLine, foundingText } from '../lib/founded-display'

/**
 * A company's founding year, with where it came from.
 *
 * Two sizes of the same claim. `compact` is one line for a list row; the full
 * form adds the source class, the disagreement where there is one, and the
 * sentence the year was read from.
 *
 * The rules it renders are in src/lib/founded-display.js and are tested there:
 * a year never appears without a source, the source's CLASS is always shown
 * because a prospectus and an aggregator profile are not equal evidence, and
 * incorporation is never labelled "Founded".
 */
export default function FoundingLine({ row, compact = false, className = '' }) {
  const line = foundingLine(row)
  if (!line) return null

  const text = foundingText(line)
  const label = [
    text,
    line.conflict ? 'sources disagree' : null,
    line.sourceHost || line.sourceLabel,
  ].filter(Boolean).join(', ')

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`} title={label}>
        <Calendar aria-hidden className="w-3.5 h-3.5" />
        {text}
        {line.conflict && <sup className="text-muted/70" aria-hidden>†</sup>}
        {line.weak && <span aria-hidden className="text-muted/60 text-[10px] ml-0.5">?</span>}
        <span className="sr-only">, source: {line.sourceHost || line.sourceLabel}</span>
      </span>
    )
  }

  return (
    <div className={`text-[13px] font-sans ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-ink">
        <Calendar aria-hidden className="w-3.5 h-3.5 text-muted" />
        <span className="font-medium">{text}</span>
        {line.conflict && <sup className="text-muted" aria-hidden>†</sup>}
      </span>

      <span className="text-muted">
        {' · '}
        {line.url
          ? <a href={line.url} target="_blank" rel="noreferrer"
              className="text-accent hover:underline">{line.sourceHost}</a>
          : line.sourceLabel}
        {/* The class, always. A reader who cannot tell a filing from a
            compilation has been misled by the layout rather than the data. */}
        {line.url && line.sourceLabel !== line.sourceHost && (
          <span className="text-muted/80"> ({line.sourceLabel})</span>
        )}
      </span>

      {line.approximates && (
        <p className="mt-1 text-[11.5px] text-muted leading-snug">
          This is when the company was registered, not when it was founded. A company can trade
          for years before it registers, and re-registering resets the date.
        </p>
      )}
      {line.conflict && (
        <p className="mt-1 text-[11.5px] text-muted leading-snug">
          <span aria-hidden>† </span>{line.conflict}
        </p>
      )}
      {line.weak && !line.conflict && (
        <p className="mt-1 text-[11.5px] text-muted leading-snug">
          This year comes from a compilation that cites no source of its own.
        </p>
      )}
    </div>
  )
}
