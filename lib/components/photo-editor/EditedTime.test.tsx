/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'

import { EditedTime, formatEditedAgo } from './EditedTime'

describe('formatEditedAgo', () => {
  const now = Date.parse('2026-01-01T12:00:00Z')

  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 minute ago'],
    [5 * 60_000, '5 minutes ago']
  ])('%i ms ago reads "%s"', (ago, text) => {
    expect(formatEditedAgo(new Date(now - ago), now)).toBe(text)
  })
})

describe('EditedTime', () => {
  afterEach(() => vi.useRealTimers())

  it('moves on from "just now" while the page stays open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    render(<EditedTime date={new Date('2026-01-01T12:00:00Z')} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
  })
})
