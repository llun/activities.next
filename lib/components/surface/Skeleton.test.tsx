/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { SkeletonBar, SkeletonRows } from './Skeleton'

describe('Skeleton', () => {
  it('draws a bar with the shared shimmer class, hidden from assistive tech', () => {
    const { container } = render(<SkeletonBar className="h-5 w-32" />)
    const bar = container.firstElementChild
    expect(bar).toHaveClass('skeleton', 'h-5', 'w-32')
    expect(bar).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws the requested number of rows with one polite Loading', () => {
    const { container } = render(<SkeletonRows rows={4} />)
    expect(container.querySelectorAll('.skeleton')).toHaveLength(4)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.getAllByText('Loading')).toHaveLength(1)
  })

  it('names what is loading', () => {
    render(<SkeletonRows label="Loading photos" />)
    expect(screen.getByText('Loading photos')).toHaveClass('sr-only')
  })
})
