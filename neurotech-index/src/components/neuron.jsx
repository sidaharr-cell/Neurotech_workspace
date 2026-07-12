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

/** Image with graceful fallback to the neuron cover. */
export function Cover({ item, tint, className = '' }) {
  const [broken, setBroken] = useState(false)
  const img = item.metadata?.image
  if (img && !broken) {
    return (
      <img
        src={img}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className={`object-cover w-full h-full ${className}`}
      />
    )
  }
  return <NeuronCover seed={item.title || item.id || ''} tint={tint} className={`w-full h-full ${className}`} />
}

/** Faint, fixed full-page neuron backdrop — atmosphere without distraction. */
export function NeuronBackdrop() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
        <g stroke="#0B2540" strokeOpacity="0.035" strokeWidth="1.2" fill="none">
          <path d="M60,120 Q180,60 300,140 T560,120 M300,140 Q360,260 300,360" />
          <path d="M980,80 Q1080,180 1000,300 T1120,520 M1000,300 Q900,340 860,240" />
          <path d="M120,640 Q260,560 380,660 T640,640 M380,660 Q420,540 520,560" />
          <path d="M760,700 Q880,620 1000,700 T1160,660" />
        </g>
        <g fill="#0B2540" fillOpacity="0.045">
          {[[300, 140], [560, 120], [300, 360], [1000, 300], [1120, 520], [860, 240], [380, 660], [640, 640], [520, 560], [1000, 700]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 6 : 4} />
          ))}
        </g>
      </svg>
    </div>
  )
}
