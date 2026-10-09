/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { AnchorHTMLAttributes, ReactNode } from 'react'

import type { FitnessActivitySummary } from '@/lib/fitness/calendar/types'

import { ActivityTypeBreakdown } from './ActivityTypeBreakdown'

// next/link swallows `prefetch` and `scroll` instead of reflecting them in the
// DOM, so the only way to assert on them is to render them ourselves. Neither
// may be spread onto the `<a>`: they are not valid DOM attributes.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    scroll,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    scroll?: boolean
    children: ReactNode
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      data-scroll={String(scroll)}
      {...rest}
    >
      {children}
    </a>
  )
}))

const summary: FitnessActivitySummary[] = [
  {
    activityType: 'run',
    count: 3,
    totalDistanceMeters: 15000,
    totalDurationSeconds: 5400,
    totalElevationGainMeters: 120
  },
  {
    activityType: 'gravel_ride',
    count: 2,
    totalDistanceMeters: 42000,
    totalDurationSeconds: 7500,
    totalElevationGainMeters: 300
  }
]

// An actor holding both the canonical form and the spelling Strava sent before
// it was applied on write. Capitalising is case-insensitive, so both rows would
// otherwise read "Run".
const collidingSummary: FitnessActivitySummary[] = [
  summary[0],
  {
    activityType: 'Run',
    count: 2,
    totalDistanceMeters: 9000,
    totalDurationSeconds: 3000,
    totalElevationGainMeters: 60
  }
]

const untyped: FitnessActivitySummary = {
  activityType: null,
  count: 4,
  totalDistanceMeters: 0,
  totalDurationSeconds: 3600,
  totalElevationGainMeters: 0
}

const cellText = (cell: HTMLElement) =>
  cell.textContent?.replace(/\u00a0/g, ' ')

describe('ActivityTypeBreakdown', () => {
  it('reports count, duration and distance per activity type, longest first', () => {
    render(<ActivityTypeBreakdown summary={summary} />)

    expect(
      screen.getByRole('heading', { name: 'Activity types' })
    ).toBeInTheDocument()
    // The header ORDER, not just its presence: Duration lands between two
    // right-aligned tabular-nums columns, so swapping two header labels while
    // leaving the cells alone is invisible to a per-header existence check and
    // would file every duration under "Distance".
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent)
    ).toEqual(['Activity', 'Count', 'Duration', 'Distance'])

    const rows = screen.getAllByRole('row').slice(1)
    // Each name carries the emoji its posts are captioned with; a qualified
    // bike sport keeps its own glyph rather than the generic-workout one.
    expect(rows[0]).toHaveTextContent('\u{1F6B4}Gravel Ride')
    expect(rows[1]).toHaveTextContent('\u{1F3C3}Run')
    const runCells = within(rows[1]).getAllByRole('cell')
    expect(cellText(runCells[1])).toBe('3')
    expect(cellText(runCells[2])).toBe('1h 30m')
    expect(cellText(runCells[3])).toBe('15.0 km')
  })

  it('links each activity name to that type filter without prefetching it', () => {
    render(<ActivityTypeBreakdown summary={summary} />)

    const link = screen.getByRole('link', { name: 'Gravel Ride' })
    // The stored value, encoded — the page matches `?activity=` against the
    // column verbatim.
    expect(link).toHaveAttribute('href', '/fitness?activity=gravel_ride')
    expect(link).toHaveAttribute('title', 'Show recent Gravel Ride activities')
    expect(link).toHaveAttribute('data-prefetch', 'false')
    // `scroll={false}` is the premise the recent-activities announcement rests
    // on: the filter navigation must move nothing.
    expect(link).toHaveAttribute('data-scroll', 'false')
    expect(link).not.toHaveAttribute('aria-current')
  })

  it('turns the selected activity into a link that clears the filter', () => {
    render(
      <ActivityTypeBreakdown summary={summary} selectedActivityType="run" />
    )

    const selected = screen.getByRole('link', { name: 'Run' })
    expect(selected).toHaveAttribute('href', '/fitness')
    expect(selected).toHaveAttribute('title', 'Clear filter')
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: 'Gravel Ride' })).toHaveAttribute(
      'href',
      '/fitness?activity=gravel_ride'
    )
  })

  it('tells apart two stored spellings that differ only in case', () => {
    render(<ActivityTypeBreakdown summary={collidingSummary} />)

    expect(screen.getByRole('link', { name: 'Run (run)' })).toHaveAttribute(
      'href',
      '/fitness?activity=run'
    )
    expect(screen.getByRole('link', { name: 'Run (Run)' })).toHaveAttribute(
      'href',
      '/fitness?activity=Run'
    )
    expect(screen.queryByRole('link', { name: 'Run' })).not.toBeInTheDocument()
  })

  it('counts untyped activities on a plain Workout row that is not a filter', () => {
    render(
      <ActivityTypeBreakdown
        summary={[...summary, untyped]}
        selectedActivityType="run"
      />
    )

    const workout = screen.getByText('Workout')
    expect(workout.closest('a')).toBeNull()
    expect(
      screen.queryByRole('link', { name: 'Workout' })
    ).not.toBeInTheDocument()
    const cells = within(workout.closest('tr') as HTMLElement).getAllByRole(
      'cell'
    )
    expect(cells[0]).toHaveTextContent('🏋️')
    expect(cellText(cells[1])).toBe('4')
    expect(cellText(cells[2])).toBe('1h')
    // The typed rows keep their links and the selected one its state.
    expect(screen.getByRole('link', { name: 'Run' })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  it('keeps the table shape with skeleton rows while loading', () => {
    render(<ActivityTypeBreakdown summary={[]} loading />)

    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByRole('table').parentElement).toHaveAttribute(
      'aria-busy',
      'true'
    )
  })
})
