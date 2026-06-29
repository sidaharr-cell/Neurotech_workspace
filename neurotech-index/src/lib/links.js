/**
 * links.js — derived-first entity linking.
 *
 * Rather than storing foreign keys, we resolve relationships at runtime by
 * matching on existing string fields (author name → researcher record,
 * device.manufacturer → organization, org.founders → researchers, etc.).
 * This keeps the graph working with zero schema changes; it can be hardened
 * into real FKs later without changing call sites.
 */

export const slugify = (str = '') =>
  str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const norm = (str = '') =>
  str.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Build a lookup graph from the four loaded entity arrays. Call once and pass
 * the result to the resolvers below. Keys are normalized names.
 */
export function buildGraph({ papers = [], devices = [], organizations = [], researchers = [] }) {
  const peopleByName = new Map()
  researchers.forEach(r => peopleByName.set(norm(r.name), r))

  const orgsByName = new Map()
  organizations.forEach(o => orgsByName.set(norm(o.name), o))

  return { papers, devices, organizations, researchers, peopleByName, orgsByName }
}

/** Resolve a person by display name → researcher record (or null). */
export function findPerson(graph, name) {
  if (!graph || !name) return null
  return graph.peopleByName.get(norm(name)) || null
}

/** Resolve an organization by name, tolerant of substrings (e.g. a device
 *  manufacturer "Neuralink" matching org "Neuralink"). */
export function findOrg(graph, name) {
  if (!graph || !name) return null
  const exact = graph.orgsByName.get(norm(name))
  if (exact) return exact
  const n = norm(name)
  return graph.organizations.find(o => {
    const on = norm(o.name)
    return on && (n.includes(on) || on.includes(n))
  }) || null
}

/** Papers (co-)authored by a given person name (derived). */
export function papersByAuthor(graph, name) {
  if (!graph || !name) return []
  const n = norm(name)
  return graph.papers.filter(p =>
    (Array.isArray(p.authors) ? p.authors : [p.authors]).some(a => norm(a || '') === n)
  )
}

/** Devices developed by an organization name (derived via manufacturer). */
export function devicesByOrg(graph, orgName) {
  if (!graph || !orgName) return []
  const n = norm(orgName)
  return graph.devices.filter(d => norm(d.manufacturer || '').includes(n) || n.includes(norm(d.manufacturer || '')))
}

/** People affiliated with an organization name (derived via affiliation). */
export function peopleByOrg(graph, orgName) {
  if (!graph || !orgName) return []
  const n = norm(orgName)
  return graph.researchers.filter(r => norm(r.affiliation || '').includes(n))
}
