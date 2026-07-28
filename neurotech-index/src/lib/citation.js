/**
 * citation.js — build BibTeX and RIS from a stored paper record (Phase 9).
 * No third party is scraped; everything comes from the fields we already hold
 * (authors, title, venue, year, DOI, URL). Pure and unit-tested.
 */

const authorsOf = p => (Array.isArray(p.authors) ? p.authors : p.authors ? [p.authors] : []).map(a => String(a).trim()).filter(Boolean)
const yearOf = p => (p.year ? String(p.year).slice(0, 4) : '')

// BibTeX special characters must be escaped or the entry fails to import.
const BIBTEX_ESCAPE = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }
export function escapeBibtex(s) {
  return String(s ?? '').replace(/[\\{}&%$#_~^]/g, c => BIBTEX_ESCAPE[c])
}

// A stable-ish cite key: firstAuthorSurname + year + first title word.
export function citeKey(p) {
  const first = authorsOf(p)[0] || ''
  const surname = first.includes(',') ? first.split(',')[0] : first.split(/\s+/)[0]
  const titleWord = String(p.title || '').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).find(Boolean) || 'ref'
  return `${(surname || 'ref').replace(/[^A-Za-z0-9]/g, '')}${yearOf(p) || ''}${titleWord.toLowerCase()}`.replace(/[^A-Za-z0-9]/g, '') || 'ref'
}

export function bibtex(p) {
  const fields = []
  const add = (k, v) => { if (v) fields.push(`  ${k} = {${escapeBibtex(v)}}`) }
  add('title', p.title)
  if (authorsOf(p).length) fields.push(`  author = {${authorsOf(p).map(escapeBibtex).join(' and ')}}`)
  add('journal', p.journal)
  if (yearOf(p)) fields.push(`  year = {${yearOf(p)}}`)
  add('doi', p.doi)
  add('url', p.url || (p.doi ? `https://doi.org/${p.doi}` : ''))
  return `@article{${citeKey(p)},\n${fields.join(',\n')}\n}\n`
}

export function ris(p) {
  const lines = ['TY  - JOUR']
  if (p.title) lines.push(`TI  - ${p.title}`)
  for (const a of authorsOf(p)) lines.push(`AU  - ${a}`)
  if (p.journal) lines.push(`JO  - ${p.journal}`)
  if (yearOf(p)) lines.push(`PY  - ${yearOf(p)}`)
  if (p.doi) lines.push(`DO  - ${p.doi}`)
  const url = p.url || (p.doi ? `https://doi.org/${p.doi}` : '')
  if (url) lines.push(`UR  - ${url}`)
  lines.push('ER  - ')
  return lines.join('\n') + '\n'
}
