/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { NotificationBadge } from './NotificationBadge'

describe('NotificationBadge', () => {
  it.each([0, -1])('renders nothing for a count of %i', (count) => {
    const { container } = render(<NotificationBadge count={count} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [142, '99+']
  ])('labels a count of %i as %s', (count, label) => {
    render(<NotificationBadge count={count} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('fills with the design count-badge red: #B7282E in light, --destructive in dark', () => {
    render(<NotificationBadge count={3} />)
    const badge = screen.getByText('3')
    // Not the #EF4444 --destructive token in light: white on it is only 3.8:1.
    expect(badge).toHaveClass(
      'bg-[#B7282E]',
      'dark:bg-destructive',
      'text-white'
    )
    expect(badge).not.toHaveClass('bg-destructive')
  })

  it('keeps the 18 px pill geometry with the 12 px medium label', () => {
    render(<NotificationBadge count={3} />)
    expect(screen.getByText('3')).toHaveClass(
      'min-w-[18px]',
      'h-[18px]',
      'rounded-full',
      'text-xs',
      'font-medium'
    )
  })
})
