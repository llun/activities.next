/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
})
