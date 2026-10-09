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
})
