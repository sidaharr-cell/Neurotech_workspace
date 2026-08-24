// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Section } from './WhatsNewDialog'
import { PREVIEW_PER_CATEGORY } from '../lib/whatsNew'

afterEach(cleanup)

const items = n => Array.from({ length: n }, (_, i) => ({
  id: `i${i}`, title: `Item ${i}`, href: `/item/i${i}`, url: null, meta: 'Nature', byline: null, tldr: null,
}))

const renderSection = (n, over = {}) => render(
  <MemoryRouter>
    <Section section={{ key: 'research', label: 'Research', items: items(n), ...over }} />
  </MemoryRouter>,
)

const rows = () => screen.getAllByRole('listitem')

describe('WhatsNewDialog section fold', () => {
  it('shows the first ten and folds the rest away', () => {
    renderSection(17)
    expect(rows()).toHaveLength(PREVIEW_PER_CATEGORY)
    expect(screen.getByRole('button', { name: /Show 7 more/ })).toBeTruthy()
  })

  it('counts the whole day in the heading, not what is on screen', () => {
    renderSection(17)
    expect(within(screen.getByRole('heading')).getByText('(17)')).toBeTruthy()
  })

  it('opens to the full list and closes again', () => {
    renderSection(17)
    const open = screen.getByRole('button', { name: /Show 7 more/ })
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    expect(rows()).toHaveLength(17)
    const close = screen.getByRole('button', { name: /Show fewer/ })
    expect(close.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(close)
    expect(rows()).toHaveLength(PREVIEW_PER_CATEGORY)
  })

  it('offers nothing to open when the category fits', () => {
    renderSection(PREVIEW_PER_CATEGORY)
    expect(rows()).toHaveLength(PREVIEW_PER_CATEGORY)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('prints the byline under the title, and nothing where there is none', () => {
    const [a, b] = items(2)
    renderSection(0, { items: [{ ...a, byline: 'Chen Wang et al.' }, b] })
    expect(screen.getByText('Chen Wang et al.')).toBeTruthy()
    // The second row has a source line and no byline above it.
    expect(within(rows()[1]).queryByText(/et al\./)).toBeNull()
  })
})
