/**
 * airtable.js — read a public Airtable shared *grid* view from Node, with no
 * API key. Used to keep the company + academic-lab lists auto-updating from the
 * NeuroTechX ecosystem base (someone else's base, shared read-only).
 *
 * How: the share page (https://airtable.com/<shareId>) embeds the current,
 * signed `accessPolicy` and the grid `viewId`. We scrape both at run time —
 * so this survives Airtable rotating the signature/expiry — then call the same
 * `readSharedViewData` endpoint the web client uses and decode the rows
 * (resolving single/multi-select choice ids and linked-record display names).
 *
 * Returns { columns: string[], rows: Array<Record<string, any>> }.
 * Throws on any failure so callers can fall back to a committed snapshot.
 */
const UA = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
}

export async function fetchSharedView(shareId) {
  const pageRes = await fetch(`https://airtable.com/${shareId}`, { headers: UA })
  if (!pageRes.ok) throw new Error(`share page ${shareId}: HTTP ${pageRes.status}`)
  const html = await pageRes.text()

  const viewId = (
    html.match(/\/view\/(viw[A-Za-z0-9]{14,17})\/readSharedViewData/) ||
    html.match(/(viw[A-Za-z0-9]{14,17})/)
  )?.[1]
  const accessPolicy = html.match(/accessPolicy=([^"&\\]+)/)?.[1]
  const appId = html.match(/applicationId%22%3A%22(app[A-Za-z0-9]+)%22/)?.[1]
  if (!viewId || !accessPolicy) {
    throw new Error(`could not parse share page ${shareId} (view=${viewId}, accessPolicy=${!!accessPolicy})`)
  }

  const params = encodeURIComponent('{"shouldUseNestedResponseFormat":true}')
  const reqId = 'req' + Math.random().toString(36).slice(2, 12)
  const url =
    `https://airtable.com/v0.3/view/${viewId}/readSharedViewData` +
    `?stringifiedObjectParams=${params}&requestId=${reqId}&accessPolicy=${accessPolicy}`

  const res = await fetch(url, {
    headers: {
      'x-airtable-application-id': appId || '',
      'x-airtable-inter-service-client': 'webClient',
      'x-time-zone': 'America/New_York',
      'x-user-locale': 'en',
      'x-requested-with': 'XMLHttpRequest',
      ...UA,
    },
  })
  if (!res.ok) throw new Error(`readSharedViewData ${shareId}: HTTP ${res.status}`)
  const json = await res.json()
  const table = json?.data?.table
  if (!table?.rows) throw new Error(`readSharedViewData ${shareId}: unexpected response shape`)

  // choice id -> label maps for select/multiselect columns
  const choiceMap = {}
  const colName = {}
  for (const c of table.columns) {
    colName[c.id] = c.name
    const choices = c.typeOptions?.choices
    if (choices) {
      choiceMap[c.id] = {}
      for (const o of Object.values(choices)) choiceMap[c.id][o.id] = o.name
    }
  }
  const decode = (colId, v) => {
    if (v == null) return null
    const cm = choiceMap[colId]
    if (Array.isArray(v)) return v.map(x => (cm && cm[x]) || x?.foreignRowDisplayName || x?.name || x)
    if (cm && cm[v]) return cm[v]
    if (typeof v === 'object' && v.name) return v.name
    return v
  }
  const rows = table.rows.map(r => {
    const o = {}
    for (const [cid, val] of Object.entries(r.cellValuesByColumnId || {})) o[colName[cid]] = decode(cid, val)
    return o
  })
  return { columns: table.columns.map(c => c.name), rows }
}
