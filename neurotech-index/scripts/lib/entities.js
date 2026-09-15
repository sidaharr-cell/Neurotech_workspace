// PubMed titles/journals carry HTML/XML entities (&#x2122; &amp; &lt; …) that
// otherwise render as literal text on the page. Decode them after stripping tags
// (tags first, so an encoded &lt;i&gt; can't reappear as a real tag).
//
// scripts/seed-patents.js keeps its own decoder on purpose: it covers a
// patent-specific set (&hellip; &mdash; &ndash;) and no hex escapes.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export const decodeEntities = s => (s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&([a-z]+);/gi, (m, n) => Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : m)

export const stripTags = s => decodeEntities((s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
