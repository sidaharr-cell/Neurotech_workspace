// @vitest-environment jsdom
import React from 'react'   // vitest transforms this file with the classic JSX runtime
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { fmtUsd, fmtMonthYear } from '../lib/fundingBoard'

// The component fetches on mount. Stub the query layer so these tests cover
// rendering only; the ranking itself is tested in fundingBoard.test.js.
const board = { rows: [], meta: {} }
vi.mock('../lib/fundingBoard', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, getFundingBoard: () => Promise.resolve(board) }
})

const { default: FundingChart } = await import('./FundingChart')

const org = (over = {}) => ({
  id: over.id || 'id-1', name: 'Test Co', type: 'company',
  capital_scope: 'private_only', total_raised_usd: 100e6, ...over,
})

async function renderWith(orgs, meta = {}) {
  const { toRow } = await import('../lib/fundingBoard')
  board.rows = orgs.map(o => toRow(o))
  board.meta = { organizationsTracked: 1084, fundedCount: orgs.length,
    lastIngestedAt: '2026-07-28T00:00:00Z', ...meta }
  render(<MemoryRouter><FundingChart /></MemoryRouter>)
  await screen.findByRole('figure', {}, { timeout: 2000 }).catch(() => {})
  return screen.findByText(/neurotech companies/i)
}

afterEach(cleanup)

describe('formatting', () => {
  it('renders a month and a full year, not a two-digit day-like year', () => {
    expect(fmtMonthYear('2025-06-15')).toBe('Jun 2025')
  })
  it('formats billions and millions', () => {
    expect(fmtUsd(1_244_412_251)).toBe('$1.2B')
    expect(fmtUsd(163_000_000)).toBe('$163M')
  })
})

describe('FundingChart', () => {
  it('renders the reason for a null latest raise, never n/a', async () => {
    await renderWith([
      org({ id: 'a', name: 'Axonics', status: 'public',
        latest_raise_usd: null, latest_raise_unavailable_reason: 'not_applicable_public' }),
    ])
    expect(await screen.findByText('Public', { selector: 'span.text-muted\\/70' })).toBeTruthy()
    expect(screen.queryByText('n/a')).toBeNull()
  })

  it('distinguishes the five situations that used to share one n/a', async () => {
    await renderWith([
      org({ id: 'a', name: 'A', total_raised_usd: 500e6, latest_raise_unavailable_reason: 'no_filing_found' }),
      org({ id: 'b', name: 'B', total_raised_usd: 400e6, latest_raise_unavailable_reason: 'foreign_issuer_not_covered' }),
      org({ id: 'c', name: 'C', total_raised_usd: 300e6, status: 'acquired', latest_raise_unavailable_reason: 'not_applicable_acquired' }),
    ])
    expect(screen.getByText('None found')).toBeTruthy()
    expect(screen.getByText('Non-US')).toBeTruthy()
    // 'C' is acquired, so it is hidden by the default status filter.
    expect(screen.queryByText('C')).toBeNull()
    expect(screen.getByText(/1 acquired or defunct company hidden/)).toBeTruthy()
  })

  // The "Min stage" filter lists every stage name, so stage assertions are
  // scoped to the row itself rather than to the whole card.
  const firstRow = () => within(screen.getAllByRole('link')[0])

  it('renders no stage badge when the stage is null, not "Unknown"', async () => {
    await renderWith([org({ id: 'a', name: 'Nostage', furthest_stage: null })])
    expect(firstRow().queryByText('Unknown')).toBeNull()
    expect(firstRow().queryByText(/510\(k\)|Pivotal|Feasibility/)).toBeNull()
  })

  it('renders a stage badge when there is evidence for it', async () => {
    await renderWith([org({ id: 'a', name: 'Staged', furthest_stage: 'cleared_510k',
      stage_evidence_type: 'openfda', stage_evidence_id: 'K183303' })])
    expect(firstRow().getByText('510(k) cleared')).toBeTruthy()
  })

  it('renders long company names in full, with no truncation class', async () => {
    const long = 'Axonics Modulation Technologies, Incorporated'
    await renderWith([org({ id: 'a', name: long })])
    const el = screen.getByText(long)
    expect(el.className).not.toContain('truncate')
    expect(el.className).toContain('break-words')
  })

  it('titles itself after the active sort key', async () => {
    await renderWith([org({ id: 'a', name: 'A' })])
    expect(screen.getByRole('heading', { level: 2 }).textContent)
      .toMatch(/by total capital raised/i)
  })

  it('marks a private-only total on a public company and footnotes it', async () => {
    await renderWith([org({ id: 'a', name: 'Axonics', status: 'public' })])
    expect(screen.getByTitle('Private capital only').textContent).toBe('†')
    expect(screen.getByText(/Excludes capital raised on the public markets/)).toBeTruthy()
  })

  it('gives every row a rank and a link to the organization', async () => {
    await renderWith([
      org({ id: 'a', name: 'First', total_raised_usd: 900e6 }),
      org({ id: 'b', name: 'Second', total_raised_usd: 100e6 }),
    ])
    const links = screen.getAllByRole('link')
    expect(links[0].getAttribute('href')).toBe('/company/a')
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('names each row for a screen reader with company, total, status and stage', async () => {
    await renderWith([org({ id: 'a', name: 'Axonics', status: 'public',
      furthest_stage: 'approved_pma', stage_evidence_type: 'openfda', stage_evidence_id: 'P960009',
      modality: 'neuromodulation' })])
    const label = screen.getAllByRole('link')[0].getAttribute('aria-label')
    expect(label).toContain('Axonics')
    expect(label).toContain('raised')
    expect(label).toContain('Public')
    expect(label).toContain('PMA approved')
  })

  // The rule moved off the caption and onto a tip beside it, so the caption
  // carries source, coverage and date, and the rule is one hover away. The
  // point of the test is unchanged: a reader can still reach the definition
  // the totals are selected by without leaving the figure.
  it('states the source and the tracked count in the caption', async () => {
    await renderWith([org({ id: 'a', name: 'A' })])
    expect(screen.getByText(/from SEC Form D filings/)).toBeTruthy()
    expect(screen.getByText(/of 1084 tracked companies/)).toBeTruthy()
  })

  it('keeps the inclusion rule reachable from the caption', async () => {
    await renderWith([org({ id: 'a', name: 'A' })])
    screen.getByRole('button', { name: /what counts as a neurotech company/i }).click()
    expect(await screen.findByText(/primary product interfaces with, measures, or modulates/))
      .toBeTruthy()
  })

  it('offers a semantic table view of the same data', async () => {
    await renderWith([org({ id: 'a', name: 'Tabled', furthest_stage: null })])
    screen.getByRole('button', { name: /view as table/i }).click()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'Tabled' })).toBeTruthy()
    // A null stage reads as an explicit absence, not a guess.
    expect(within(table).getAllByText('Not available').length).toBeGreaterThan(0)
  })
})
