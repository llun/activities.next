/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { AnchorHTMLAttributes, ReactNode } from 'react'

import {
  FitnessActivitySummary,
  FitnessCalendarDay,
  getFitnessCalendarData,
  getFitnessSummary
} from '@/lib/client'

import { ActorFitnessDashboard } from './ActorFitnessDashboard'

vi.mock('@/lib/client', () => ({
  getFitnessSummary: vi.fn(),
  getFitnessCalendarData: vi.fn()
}))

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

const mockedGetFitnessSummary = vi.mocked(getFitnessSummary)
const mockedGetFitnessCalendarData = vi.mocked(getFitnessCalendarData)

const ACTOR_ID = 'https://activities.local/users/llun'
const FIXED_CURRENT_TIME = new Date('2026-04-30T10:05:00.000Z').getTime()
const DAY_MS = 24 * 60 * 60 * 1000

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
  {
    activityType: 'run',
    count: 3,
    totalDistanceMeters: 15000,
    totalDurationSeconds: 5400,
    totalElevationGainMeters: 120
  },
  {
    activityType: 'Run',
    count: 2,
    totalDistanceMeters: 9000,
    totalDurationSeconds: 3000,
    totalElevationGainMeters: 60
  }
]

const calendarDays: FitnessCalendarDay[] = [
  {
    date: '2026-04-29',
    count: 1,
    totalDistanceMeters: 5000,
    totalDurationSeconds: 1800
  }
]

// Mirror the component's local-calendar formatter so the expected query window
// is computed the same way regardless of the host machine timezone.
const formatLocalDateInput = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Reproduce the start/end millisecond bounds the dashboard sends for a preset:
// a local-calendar YYYY-MM-DD parsed back as UTC midnight, end-exclusive.
const expectedWindow = (now: number, days: number) => {
  const startMs = new Date(
    formatLocalDateInput(new Date(now - days * DAY_MS))
  ).getTime()
  const endMs = new Date(formatLocalDateInput(new Date(now))).getTime()
  return { startDate: startMs, endDate: endMs + DAY_MS }
}

const expectedYearWindow = (now: number) => {
  const year = new Date(now).getFullYear()
  const startMs = new Date(formatLocalDateInput(new Date(year, 0, 1))).getTime()
  const endMs = new Date(formatLocalDateInput(new Date(year, 11, 31))).getTime()
  return { startDate: startMs, endDate: endMs + DAY_MS }
}

describe('ActorFitnessDashboard', () => {
  beforeEach(() => {
    // Pin Date.now() (read by the hydration effect + applyPreset) so the query
    // window is deterministic. shouldAdvanceTime keeps the real clock ticking so
    // waitFor polling and promise microtasks still resolve.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(FIXED_CURRENT_TIME)
    mockedGetFitnessSummary.mockResolvedValue(summary)
    mockedGetFitnessCalendarData.mockResolvedValue(calendarDays)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders exactly the YTD/1Y/5Y/10Y presets and no 30D/90D presets', () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    expect(screen.getByRole('button', { name: 'YTD' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1Y' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5Y' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10Y' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '2Y' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '30D' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '90D' })
    ).not.toBeInTheDocument()
  })

  it('marks YTD as the initially selected preset', () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    const activeClasses = ['bg-foreground', 'text-background']
    expect(screen.getByRole('button', { name: 'YTD' })).toHaveClass(
      ...activeClasses
    )
    for (const label of ['1Y', '5Y', '10Y']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveClass(
        ...activeClasses
      )
    }
  })

  it('requests the full calendar year window for the default YTD preset on load', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    const windowYtd = expectedYearWindow(FIXED_CURRENT_TIME)
    await waitFor(() => {
      expect(mockedGetFitnessSummary).toHaveBeenLastCalledWith({
        actorId: ACTOR_ID,
        ...windowYtd
      })
    })
    expect(mockedGetFitnessCalendarData).toHaveBeenLastCalledWith({
      actorId: ACTOR_ID,
      ...windowYtd
    })
  })

  it.each([
    { label: '1Y', days: 365 },
    { label: '5Y', days: 1825 },
    { label: '10Y', days: 3650 }
  ])(
    'requests a $days-day window when the $label preset is selected',
    async ({ label, days }) => {
      render(
        <ActorFitnessDashboard
          actorId={ACTOR_ID}
          currentTime={FIXED_CURRENT_TIME}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: label }))

      const window = expectedWindow(FIXED_CURRENT_TIME, days)
      await waitFor(() => {
        expect(mockedGetFitnessSummary).toHaveBeenLastCalledWith({
          actorId: ACTOR_ID,
          ...window
        })
      })
      expect(mockedGetFitnessCalendarData).toHaveBeenLastCalledWith({
        actorId: ACTOR_ID,
        ...window
      })
    }
  )

  it('requests the full calendar year window when switching back to YTD', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '1Y' }))

    const window365 = expectedWindow(FIXED_CURRENT_TIME, 365)
    await waitFor(() => {
      expect(mockedGetFitnessSummary).toHaveBeenLastCalledWith({
        actorId: ACTOR_ID,
        ...window365
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))

    const windowYtd = expectedYearWindow(FIXED_CURRENT_TIME)
    await waitFor(() => {
      expect(mockedGetFitnessSummary).toHaveBeenLastCalledWith({
        actorId: ACTOR_ID,
        ...windowYtd
      })
    })
    expect(mockedGetFitnessCalendarData).toHaveBeenLastCalledWith({
      actorId: ACTOR_ID,
      ...windowYtd
    })
  })
  it('titles the activity breakdown card Activities', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    expect(
      await screen.findByRole('heading', { name: 'Activities' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Activity Mix' })
    ).not.toBeInTheDocument()
  })

  it('reports a duration column beside the count and distance', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    // The header ORDER, not just its presence: Duration lands between two
    // right-aligned tabular-nums columns, so swapping two header labels while
    // leaving the cells alone is invisible to a per-header existence check and
    // would file every duration under "Distance".
    expect(
      (await screen.findAllByRole('columnheader')).map(
        (header) => header.textContent
      )
    ).toEqual(['Activity', 'Count', 'Duration', 'Distance'])

    const row = screen.getByRole('link', { name: 'Run' }).closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLElement).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('3')
    expect(cells[2]).toHaveTextContent('1h 30m')
    expect(cells[3]).toHaveTextContent('15.0 km')
  })

  it('names each activity with the emoji its posts are captioned with', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    const runRow = (await screen.findByRole('link', { name: 'Run' })).closest(
      'tr'
    )
    expect(runRow).toHaveTextContent('\u{1F3C3}')
    // A qualified bike sport keeps its own glyph rather than taking the
    // generic-workout fallback, which is what a raw-string-only lookup gave it.
    expect(
      screen.getByRole('link', { name: 'Gravel Ride' }).closest('tr')
    ).toHaveTextContent('\u{1F6B4}')
  })

  it('links each activity name to that type filter without prefetching it', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    const link = await screen.findByRole('link', { name: 'Gravel Ride' })
    // The stored value, encoded — the page matches `?activity=` against the
    // column verbatim.
    expect(link).toHaveAttribute('href', '/fitness?activity=gravel_ride')
    expect(link).toHaveAttribute('title', 'Show recent Gravel Ride activities')
    expect(link).toHaveAttribute('data-prefetch', 'false')
    // `scroll={false}` is the premise the whole announcement design rests on:
    // the filter navigation must move nothing, which is why the live region is
    // the only signal a screen reader gets. Without this assertion the prop can
    // be deleted and every test still passes, while the page silently jumps to
    // the top on each filter click.
    expect(link).toHaveAttribute('data-scroll', 'false')
    expect(link).not.toHaveAttribute('aria-current')
  })

  it('turns the selected activity into a link that clears the filter', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
        selectedActivityType="run"
      />
    )

    const selected = await screen.findByRole('link', { name: 'Run' })
    expect(selected).toHaveAttribute('href', '/fitness')
    expect(selected).toHaveAttribute('title', 'Clear filter')
    expect(selected).toHaveAttribute('aria-current', 'true')

    expect(screen.getByRole('link', { name: 'Gravel Ride' })).toHaveAttribute(
      'href',
      '/fitness?activity=gravel_ride'
    )
  })
  it('tells apart two stored spellings that differ only in case', async () => {
    // Both rows carry different numbers and link to different filters, so an
    // identical name makes two controls the reader cannot choose between — and
    // whichever they pick silently omits the other half of their runs.
    mockedGetFitnessSummary.mockResolvedValue(collidingSummary)

    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    const lowercase = await screen.findByRole('link', { name: 'Run (run)' })
    const capitalised = screen.getByRole('link', { name: 'Run (Run)' })

    expect(lowercase).toHaveAttribute('href', '/fitness?activity=run')
    expect(capitalised).toHaveAttribute('href', '/fitness?activity=Run')
    expect(screen.queryByRole('link', { name: 'Run' })).not.toBeInTheDocument()
  })

  it('leaves an unambiguous label unqualified', async () => {
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={FIXED_CURRENT_TIME}
      />
    )

    expect(await screen.findByRole('link', { name: 'Run' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Gravel Ride' })
    ).toBeInTheDocument()
  })
})
