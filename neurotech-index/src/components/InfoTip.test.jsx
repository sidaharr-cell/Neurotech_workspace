// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { InfoTip } from './ui'

afterEach(cleanup)

const tip = () => (
  <InfoTip label="How citation impact is measured">
    <a href="https://openalex.org">OpenAlex</a>
  </InfoTip>
)

describe('InfoTip', () => {
  it('keeps the explanation out of the way until it is asked for', () => {
    render(tip())
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('button', { name: 'How citation impact is measured' })).toBeTruthy()
  })

  it('opens on hover and closes when the pointer leaves', () => {
    const { container } = render(tip())
    fireEvent.mouseEnter(container.firstChild)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(container.firstChild)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens on keyboard focus, so the source link is reachable without a pointer', () => {
    render(tip())
    fireEvent.focus(screen.getByRole('button'))
    expect(screen.getByRole('link', { name: 'OpenAlex' })).toBeTruthy()
  })

  it('closes on Escape', () => {
    render(tip())
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('names the panel it controls', () => {
    render(tip())
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe(screen.getByRole('tooltip').id)
  })
})
