/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { NotificationsLoading } from './loading'

describe('notifications loading', () => {
  it('announces one polite Loading and draws no text on screen', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    // The only text in the tree is the screen-reader label.
    expect(container.textContent).toBe('Loading notifications')
  })

  it('draws the rows inside one frame of shimmer bars', () => {
    const { container } = render(<NotificationsLoading />)

    expect(container.querySelectorAll('[data-slot="frame"]')).toHaveLength(1)
    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(6)
  })
})
