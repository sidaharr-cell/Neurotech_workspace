import { useState } from 'react'

// Tiny seeded RNG (mulberry32) so each item's motif is stable across renders.
function rng(seedStr = '') {
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Device-class → soft tint (kept muted/editorial)
const TINTS = {
  recording: ['#EAF2FA', '#0B5FA6'],
  stimulation: ['#F3EEF9', '#6D4AA6'],
  interface: ['#EAF4F1', '#0E7C66'],
  sensory: ['#FBF0EA', '#B45A2B'],
  motor: ['#FBEFF2', '#B0325A'],
  'closed-loop': ['#EEF3EC', '#4B7A3A'],
  cognitive: ['#F4F1E9', '#8A6D2F'],
  imaging: ['#ECF0F6', '#3A5687'],
  default: ['#EEF1F5', '#3D5A80'],
}

/** A deterministic neuron/network line-art cover, tinted by device class. */
export function NeuronCover({ seed = '', tint = 'default', className = '' }) {
  const [bg, ink] = TINTS[tint] || TINTS.default
  const r = rng(seed)
  const W = 400, H = 300
  const nodes = Array.from({ length: 7 }, () => ({
    x: 30 + r() * (W - 60),
    y: 30 + r() * (H - 60),
    rad: 3 + r() * 7,
  }))
  // connect each node to its 1–2 nearest neighbours
  const edges = []
  nodes.forEach((n, i) => {
    const others = nodes.map((m, j) => ({ j, d: Math.hypot(n.x - m.x, n.y - m.y) }))
      .filter(o => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2)
    others.forEach(o => { if (i < o.j) edges.push([i, o.j]) })
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <rect width={W} height={H} fill={bg} />
      <g stroke={ink} strokeOpacity="0.35" strokeWidth="1.1" fill="none">
        {edges.map(([a, b], k) => {
          const n = nodes[a], m = nodes[b]
          const mx = (n.x + m.x) / 2 + (r() - 0.5) * 40
          const my = (n.y + m.y) / 2 + (r() - 0.5) * 40
          return <path key={k} d={`M${n.x},${n.y} Q${mx},${my} ${m.x},${m.y}`} />
        })}
      </g>
      <g fill={ink}>
        {nodes.map((n, k) => (
          <g key={k}>
            <circle cx={n.x} cy={n.y} r={n.rad} fillOpacity="0.55" />
            <circle cx={n.x} cy={n.y} r={n.rad + 3.5} fill="none" stroke={ink} strokeOpacity="0.25" />
          </g>
        ))}
      </g>
    </svg>
  )
}

/**
 * Image with graceful fallback to the neuron cover. Stock images (classified by
 * the ingestion) are never shown. With `requireReal`, only images explicitly
 * verified as real are used — the homepage lead uses this so the top story is
 * never a stock photo.
 */
export function Cover({ item, tint, requireReal = false, priority = false, className = '' }) {
  const [broken, setBroken] = useState(false)
  const img = item.metadata?.image
  const kind = item.metadata?.imageKind
  const usable = img && !broken && kind !== 'stock' && (!requireReal || kind === 'real')
  if (usable) {
    return (
      <img
        src={img}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        fetchpriority={priority ? 'high' : 'auto'}
        decoding="async"
        onError={() => setBroken(true)}
        className={`object-cover w-full h-full ${className}`}
      />
    )
  }
  return <NeuronCover seed={item.title || item.id || ''} tint={tint} className={`w-full h-full ${className}`} />
}

/** Fixed full-page neuron backdrop — a neuroscience atmosphere, kept light
 *  enough not to compete with the text. Denser network + soft dendrites. */
export function NeuronBackdrop() {
  const nodes = [
    [90, 110], [250, 70], [420, 150], [180, 300], [360, 260], [120, 470], [300, 520],
    [470, 430], [610, 180], [640, 560], [820, 110], [1000, 200], [900, 360], [1080, 430],
    [980, 610], [1140, 640], [820, 660], [700, 700], [520, 680], [220, 680],
  ]
  const edges = [
    [0, 1], [1, 2], [0, 3], [1, 4], [2, 4], [3, 5], [4, 6], [3, 4], [5, 6], [6, 7],
    [4, 7], [2, 8], [8, 9], [7, 9], [10, 11], [11, 12], [12, 13], [11, 13], [12, 14],
    [13, 15], [14, 16], [14, 15], [16, 17], [9, 16], [17, 18], [18, 19], [6, 19], [8, 11],
  ]
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% -10%, rgba(11,95,166,0.04), transparent 60%)' }} />
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 760">
        <g stroke="#0B2540" strokeOpacity="0.06" strokeWidth="1.15" fill="none" strokeLinecap="round">
          {edges.map(([a, b], i) => {
            const n = nodes[a], m = nodes[b]
            const mx = (n[0] + m[0]) / 2 + (i % 2 ? 26 : -26)
            const my = (n[1] + m[1]) / 2 + (i % 3 ? -22 : 22)
            return <path key={i} d={`M${n[0]},${n[1]} Q${mx},${my} ${m[0]},${m[1]}`} />
          })}
        </g>
        <g fill="#0B2540">
          {nodes.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={i % 4 === 0 ? 6.5 : 4.5} fillOpacity="0.07" />
              <circle cx={x} cy={y} r={(i % 4 === 0 ? 6.5 : 4.5) + 4} fill="none" stroke="#0B2540" strokeOpacity="0.045" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
