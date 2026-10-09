/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { ApiRequestError } from '@/lib/client'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { createDeferred } from '@/lib/testing/deferred'

import {
  calendarDays,
  cell,
  lastRange,
  mockedCalendar,
  mockedDay,
  mockedSummary,
  rangeTrigger,
  renderDashboard,
  setUpDashboardTest,
  shownDates,
  tearDownDashboardTest,
  text,
  waitForLoaded
} from './ActorFitnessDashboard.testUtils'

vi.mock('@/lib/client', async () => {
  const http =
    await vi.importActual<typeof import('@/lib/client/http')>(
      '@/lib/client/http'
    )
  return {
    ApiRequestError: http.ApiRequestError,
    getFitnessSummary: vi.fn(),
    getFitnessCalendarData: vi.fn(),
    getFitnessCalendarDayActivities: vi.fn()
  }
})

vi.mock('next/link', async () => ({
  default: (await import('./ActorFitnessDashboard.mocks')).MockLink
}))

describe('ActorFitnessDashboard', () => {
  beforeEach(() => {
    setUpDashboardTest()
  })

  afterEach(() => {
    tearDownDashboardTest()
  })

  describe('a day picked before any committed result covers it', () => {
    // Nothing the bucket totals could come from has landed yet, so the details
    // must not state a count: an empty day and an unknown day read differently.
    const detailsText = () =>
      text(document.querySelector('[data-testid="day-details"]'))

    it('shows no "0 activities" for a day picked while the first read is pending', async () => {
      const calendar = createDeferred<FitnessCalendarDay[]>()
      mockedCalendar.mockReturnValueOnce(calendar.promise)
      renderDashboard()

      fireEvent.click(cell('2026-10-01'))
      expect(detailsText() ?? '').not.toContain('0 activities')

      await act(async () => calendar.resolve(calendarDays))
      await waitForLoaded()
      const details = await screen.findByTestId('day-details')
      expect(text(details)).toContain('2 activities · 16.8 km · 1h 14m')
      expect(text(details)).not.toContain('0 activities')
    })

    it('shows no "0 activities" after that first read rejects, until Retry succeeds', async () => {
      const calendar = createDeferred<FitnessCalendarDay[]>()
      mockedCalendar.mockReturnValueOnce(calendar.promise)
      renderDashboard()

      fireEvent.click(cell('2026-10-01'))
      await act(async () =>
        calendar.reject(new ApiRequestError('Service Unavailable', 503))
      )
      const alert = await screen.findByRole('alert')
      expect(screen.getByTestId('calendar-region')).toHaveAttribute('inert')
      expect(detailsText() ?? '').not.toContain('0 activities')

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
      const details = await screen.findByTestId('day-details')
      expect(text(details)).toContain('2 activities · 16.8 km · 1h 14m')
    })

    it('shows no "0 activities" for a day outside the previous range while a new range loads', async () => {
      renderDashboard()
      await waitForLoaded()

      const calendar = createDeferred<FitnessCalendarDay[]>()
      mockedCalendar.mockReturnValueOnce(calendar.promise)
      fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
      await waitFor(() => expect(shownDates()).toBe('1 Jan – 31 Dec 2025'))

      // 2025 is outside the year to date that is still the last committed read.
      fireEvent.click(cell('2025-06-15'))
      expect(detailsText() ?? '').not.toContain('0 activities')

      await act(async () =>
        calendar.resolve([
          {
            date: '2025-06-15',
            count: 3,
            totalDistanceMeters: 30000,
            totalDurationSeconds: 7200,
            totalElevationGainMeters: 100
          }
        ])
      )
      await waitForLoaded()
      const details = await screen.findByTestId('day-details')
      expect(text(details)).toContain('3 activities · 30.0 km · 2h')
    })
  })

  it('scrolls the details into view for a day picked before the first read landed', async () => {
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    vi.stubGlobal('innerHeight', 700)
    const calendar = createDeferred<FitnessCalendarDay[]>()
    mockedCalendar.mockReturnValueOnce(calendar.promise)
    renderDashboard()
    const rectOf = (top: number, bottom: number) =>
      ({
        top,
        bottom,
        left: 0,
        right: 0,
        width: 0,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({})
      }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute('data-testid') === 'day-details')
          return rectOf(900, 1100)
        if (this.dataset.date === '2026-10-01') return rectOf(300, 318)
        return rectOf(0, 0)
      }
    )
    fireEvent.click(cell('2026-10-01'))
    expect(scrollBy).not.toHaveBeenCalled()
    await act(async () => calendar.resolve(calendarDays))
    await screen.findByTestId('day-details')
    await waitFor(() =>
      expect(scrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 236 })
      )
    )
  })

  it('reads a selected day without touching the range or the totals', async () => {
    renderDashboard()
    await waitForLoaded()
    const summaryCalls = mockedSummary.mock.calls.length
    const calendarCalls = mockedCalendar.mock.calls.length

    fireEvent.click(cell('2026-10-01'))

    const details = await screen.findByTestId('day-details')
    expect(
      within(details).getByRole('heading', { name: 'Thursday, 1 October 2026' })
    ).toBeInTheDocument()
    // The header totals come from the calendar bucket for the day.
    expect(text(details)).toContain('2 activities · 16.8 km · 1h 14m')
    expect(await within(details).findByText('Morning run')).toBeInTheDocument()
    expect(mockedDay).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-10-01', timeZone: 'UTC' })
    )
    expect(mockedSummary).toHaveBeenCalledTimes(summaryCalls)
    expect(mockedCalendar).toHaveBeenCalledTimes(calendarCalls)
    expect(shownDates()).toBe('1 Jan – 4 Oct 2026')
  })

  it('closes the day details on Escape and puts focus back on the day', async () => {
    renderDashboard()
    await waitForLoaded()

    fireEvent.click(cell('2026-09-24'))
    const details = await screen.findByTestId('day-details')
    const close = within(details).getByRole('button', {
      name: 'Close day details'
    })
    close.focus()
    fireEvent.keyDown(close, { key: 'Escape' })

    expect(screen.queryByTestId('day-details')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(cell('2026-09-24'))
    expect(cell('2026-09-24')).toHaveAttribute('aria-pressed', 'false')

    // Escape from the grid itself does the same.
    fireEvent.click(cell('2026-09-24'))
    await screen.findByTestId('day-details')
    fireEvent.keyDown(cell('2026-09-24'), { key: 'Escape' })
    expect(screen.queryByTestId('day-details')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(cell('2026-09-24'))
  })

  it('keeps the selected day’s totals while a new range loads', async () => {
    renderDashboard()
    await waitForLoaded()
    fireEvent.click(cell('2026-10-01'))
    const details = await screen.findByTestId('day-details')
    expect(text(details)).toContain('2 activities · 16.8 km · 1h 14m')

    // Last 12 months still contains the day, so the selection survives; its
    // read is held open to look at the details mid-reload.
    const calendar = createDeferred<FitnessCalendarDay[]>()
    mockedCalendar.mockReturnValueOnce(calendar.promise)
    fireEvent.click(rangeTrigger())
    fireEvent.click(
      await screen.findByRole('button', { name: 'Last 12 months' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2025-10-05',
        to: '2026-10-04'
      })
    )

    expect(cell('2026-10-01')).toHaveAttribute('aria-pressed', 'true')
    const during = screen.getByTestId('day-details')
    expect(text(during)).toContain('2 activities · 16.8 km · 1h 14m')
    expect(text(during)).not.toContain('0 activities')

    await act(async () => calendar.resolve(calendarDays))
  })
})
