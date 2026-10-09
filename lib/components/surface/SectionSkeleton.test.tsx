/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { SectionSkeleton } from './SectionSkeleton'

describe('SectionSkeleton', () => {
  it('announces one polite Loading and draws no visible text', () => {
    const { container } = render(<SectionSkeleton sections={[2, 1]} />)

    const status = screen.getByRole('status')
    expect(within(status).getByText('Loading')).toHaveClass('sr-only')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(container.textContent).toBe('Loading')
  })

  it('draws a frame per section with the requested number of rows', () => {
    const { container } = render(<SectionSkeleton sections={[2, 4]} />)

    const frames = container.querySelectorAll('[data-slot="frame"]')
    expect(frames).toHaveLength(2)
    // At least a bar per row; how many a row draws is its own business.
    expect(
      frames[0].querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThanOrEqual(2)
    expect(
      frames[1].querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(
      frames[0].querySelectorAll('[data-slot="skeleton-bar"]').length
    )
  })

  it('leaves out the section headings on request', () => {
    const { container } = render(
      <SectionSkeleton title={false} headings={false} sections={[2]} />
    )

    // Only the rows' bars: no title or heading bars above the frame.
    const bars = container.querySelectorAll('[data-slot="skeleton-bar"]')
    const frameBars = container.querySelectorAll(
      '[data-slot="frame"] [data-slot="skeleton-bar"]'
    )
    expect(bars.length).toBeGreaterThanOrEqual(2)
    expect(bars).toHaveLength(frameBars.length)
  })

  it('leaves out the title block on request and takes a custom label', () => {
    const { container } = render(
      <SectionSkeleton title={false} sections={[1]} label="Loading filters" />
    )

    expect(screen.getByText('Loading filters')).toBeInTheDocument()
    // The section's heading bars stay; the title/description pair does not.
    const withTitle = render(<SectionSkeleton sections={[1]} />).container
    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeLessThan(
      withTitle.querySelectorAll('[data-slot="skeleton-bar"]').length
    )
  })
})
