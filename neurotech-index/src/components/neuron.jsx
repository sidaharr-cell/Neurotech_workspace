/**
 * neuron.jsx — the page backdrop.
 *
 * The per-item neuron motif that used to stand in for a missing picture is
 * gone. A card now shows a photograph or a figure drawn from its own record;
 * see components/Figure.jsx. Generated line art told the reader nothing about
 * the item it sat above, and thirty of them read as wallpaper.
 */

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
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% -10%, rgba(11,95,166,0.02), transparent 60%)' }} />
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 760">
        <g stroke="#0B2540" strokeOpacity="0.03" strokeWidth="1" fill="none" strokeLinecap="round">
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
              <circle cx={x} cy={y} r={i % 4 === 0 ? 5.5 : 4} fillOpacity="0.038" />
              <circle cx={x} cy={y} r={(i % 4 === 0 ? 5.5 : 4) + 4} fill="none" stroke="#0B2540" strokeOpacity="0.025" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
