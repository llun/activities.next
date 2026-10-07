/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FitnessSummaryStrip, summaryTotals } from './FitnessSummaryStrip'

const valueOf = (label: string) =>
  screen
    .getByText(label, { selector: 'dt' })
    .parentElement?.querySelector('dd')
    ?.textContent?.replace(/\u00a0/g, ' ')

describe('summaryTotals', () => {
  it('adds every activity-type row, the untyped one included', () => {
    expect(
      summaryTotals([
        {
          activityType: 'run',
          count: 3,
          totalDistanceMeters: 15000,
          totalDurationSeconds: 5400,
          totalElevationGainMeters: 120
        },
        {
          activityType: null,
          count: 1,
          totalDistanceMeters: 0,
          totalDurationSeconds: 1800,
          totalElevationGainMeters: 0
        }
      ])
    ).toEqual({
      count: 4,
      totalDistanceMeters: 15000,
      totalDurationSeconds: 7200,
      totalElevationGainMeters: 120
    })
  })
})

describe('FitnessSummaryStrip', () => {
  it('shows activities, distance, duration and elevation for the range', () => {
    render(
      <FitnessSummaryStrip
        totals={{
          count: 1376,
          totalDistanceMeters: 5_261_400,
          totalDurationSeconds: 296 * 3600 + 29 * 60,
          totalElevationGainMeters: 65_374
        }}
      />
    )

    expect(valueOf('Activities')).toBe('1,376')
    expect(valueOf('Distance')).toBe('5,261 km')
    expect(valueOf('Duration')).toBe('296h 29m')
    expect(valueOf('Elevation')).toBe('65,374 m')
  })

  it('shows skeletons, not numbers, while the range loads', () => {
    render(<FitnessSummaryStrip totals={null} loading />)

    for (const label of ['Activities', 'Distance', 'Duration', 'Elevation']) {
      expect(valueOf(label)).toBe('Loading')
    }
  })

  it('draws the shared shimmering skeleton in every cell', () => {
    const { container } = render(<FitnessSummaryStrip totals={null} loading />)

    expect(
      container.querySelectorAll('[aria-hidden="true"].block.skeleton')
    ).toHaveLength(4)
  })

  it('never shows zeros for totals it does not have', () => {
    render(<FitnessSummaryStrip totals={null} />)

    // A failed first read: no data is not "0 activities".
    expect(valueOf('Activities')).not.toMatch(/0/)
    expect(valueOf('Activities')).toContain('Unavailable')
  })

  it('lays the cells out on the summary stat grid', () => {
    const { container } = render(
      <FitnessSummaryStrip
        totals={{
          count: 0,
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          totalElevationGainMeters: 0
        }}
      />
    )

    // The shared strip's container-queried columns, not a hand-rolled grid.
    expect(container.querySelector('.grid')).toHaveClass('gap-px')
    expect(container.querySelector('.grid')?.className).toMatch(
      /@min-\[16rem\]:grid-cols-2/
    )
  })
})
