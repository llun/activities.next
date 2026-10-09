/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { ApiRequestError } from '@/lib/client'

import {
  cell,
  lastRange,
  mockedCalendar,
  mockedDay,
  mockedSummary,
  monthHeading,
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

  describe('after a failed read that kept the previous results', () => {
    const failSecondRange = async () => {
      renderDashboard()
      await waitForLoaded()
      // Year 2025 is the displayed range; the step to 2024 fails.
      fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
      await waitFor(() => expect(shownDates()).toBe('1 Jan – 31 Dec 2025'))
      await waitForLoaded()
      mockedSummary.mockRejectedValueOnce(
        new ApiRequestError('Service Unavailable', 503)
      )
      fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
      const alert = await screen.findByRole('alert')
      expect(text(alert)).toContain(
        'Showing previous results for 1 Jan – 31 Dec 2025'
      )
    }

    it('steps from the range on screen, not from the one that failed', async () => {
      await failSecondRange()
      mockedSummary.mockClear()

      fireEvent.click(screen.getByRole('button', { name: 'Next year' }))

      // From the 2025 on screen, next is 2026 year to date; from the failed
      // 2024 it would be 2025.
      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2026-01-01',
          to: '2026-10-04'
        })
      )
    })

    it('reads again when the same step is pressed after it failed', async () => {
      await failSecondRange()
      mockedSummary.mockClear()

      // 2025 is on screen and 2024 failed, so Previous year targets 2024 again.
      fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2024-01-01',
          to: '2024-12-31'
        })
      )
    })

    it('reads again when the year chooser picks the year that failed', async () => {
      await failSecondRange()
      mockedSummary.mockClear()

      fireEvent.pointerDown(
        screen.getByRole('button', { name: 'Calendar year: 2025' }),
        { button: 0, pointerType: 'mouse' }
      )
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: '2024' })
      )

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2024-01-01',
          to: '2024-12-31'
        })
      )
    })

    it('reads again when Month view is pressed after that month failed', async () => {
      renderDashboard()
      await waitForLoaded()
      mockedSummary.mockRejectedValueOnce(
        new ApiRequestError('Service Unavailable', 503)
      )
      fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
      await screen.findByRole('alert')
      mockedSummary.mockClear()

      // Year to date is still on screen, so Month view targets October again.
      fireEvent.click(screen.getByRole('button', { name: /Month view/ }))

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2026-10-01',
          to: '2026-10-04'
        })
      )
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
    })

    it('opens the latest month of the range on screen', async () => {
      await failSecondRange()
      mockedSummary.mockClear()

      fireEvent.click(screen.getByRole('button', { name: /Month view/ }))

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2025-12-01',
          to: '2025-12-31'
        })
      )
    })

    it('reads again when Back to year is pressed after that year failed', async () => {
      renderDashboard()
      await waitForLoaded()
      fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2026-10-01',
          to: '2026-10-04'
        })
      )
      await waitForLoaded()
      mockedSummary.mockRejectedValueOnce(
        new ApiRequestError('Service Unavailable', 503)
      )
      fireEvent.click(screen.getByRole('button', { name: /Back to year/ }))
      await screen.findByRole('alert')
      mockedSummary.mockClear()

      // October is still on screen, so Back to year targets year to date again.
      fireEvent.click(screen.getByRole('button', { name: /Back to year/ }))

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2026-01-01',
          to: '2026-10-04'
        })
      )
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
    })

    it('reads again when a month label is pressed after that month failed', async () => {
      renderDashboard()
      await waitForLoaded()
      mockedSummary.mockRejectedValueOnce(
        new ApiRequestError('Service Unavailable', 503)
      )
      fireEvent.click(screen.getByRole('button', { name: 'Show March 2026' }))
      await screen.findByRole('alert')
      mockedSummary.mockClear()

      // Year to date is still on screen, so its March label targets March again.
      fireEvent.click(screen.getByRole('button', { name: 'Show March 2026' }))

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2026-03-01',
          to: '2026-03-31'
        })
      )
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
    })

    it('reads again when the picker applies the range that failed', async () => {
      renderDashboard()
      await waitForLoaded()
      mockedSummary.mockRejectedValueOnce(
        new ApiRequestError('Service Unavailable', 503)
      )
      fireEvent.click(rangeTrigger())
      fireEvent.click(
        await screen.findByRole('button', { name: 'Last 12 months' })
      )
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      await screen.findByRole('alert')
      mockedSummary.mockClear()

      // The picker opens on the applied range, the one that failed.
      fireEvent.click(rangeTrigger())
      fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2025-10-05',
          to: '2026-10-04'
        })
      )
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
    })

    it('reads again when the picker year chooser picks the year that failed', async () => {
      await failSecondRange()
      mockedSummary.mockClear()

      // The picker opens on the applied range, 2024, the one that failed.
      fireEvent.click(rangeTrigger())
      fireEvent.pointerDown(
        await screen.findByRole('button', { name: 'Calendar year 2024' }),
        { button: 0, pointerType: 'mouse' }
      )
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: '2024' })
      )

      await waitFor(() =>
        expect(lastRange(mockedSummary)).toEqual({
          from: '2024-01-01',
          to: '2024-12-31'
        })
      )
    })

    it('does not read again when Apply keeps a range that loaded', async () => {
      renderDashboard()
      await waitForLoaded()
      mockedSummary.mockClear()
      mockedCalendar.mockClear()

      fireEvent.click(rangeTrigger())
      fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
      await waitFor(() =>
        expect(rangeTrigger()).not.toHaveAttribute('aria-expanded', 'true')
      )
      await act(async () => {})

      expect(mockedSummary).not.toHaveBeenCalled()
      expect(mockedCalendar).not.toHaveBeenCalled()
    })

    describe('day inspection on the retained results', () => {
      it('selects a day on the annual grid that is on screen', async () => {
        await failSecondRange()
        // The grid still draws 2025; the applied range that failed is 2024.
        const calendarCalls = mockedCalendar.mock.calls.length
        const summaryCalls = mockedSummary.mock.calls.length

        fireEvent.click(cell('2025-10-01'))

        expect(cell('2025-10-01')).toHaveAttribute('aria-pressed', 'true')
        expect(await screen.findByTestId('day-details')).toBeInTheDocument()
        expect(mockedDay).toHaveBeenCalledWith(
          expect.objectContaining({ date: '2025-10-01' })
        )
        // Selecting reads nothing for the range and keeps the banner.
        expect(mockedSummary).toHaveBeenCalledTimes(summaryCalls)
        expect(mockedCalendar).toHaveBeenCalledTimes(calendarCalls)
        expect(shownDates()).toBe('1 Jan – 31 Dec 2025')
        expect(text(screen.getByRole('alert'))).toContain(
          'We couldn’t load 1 Jan – 31 Dec 2024'
        )
      })

      it('selects a day on the month grid that is on screen', async () => {
        renderDashboard()
        await waitForLoaded()
        fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
        await waitFor(() => expect(monthHeading()).toBe('October 2026'))
        await waitForLoaded()
        mockedSummary.mockRejectedValueOnce(
          new ApiRequestError('Service Unavailable', 503)
        )
        fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
        await screen.findByRole('alert')
        expect(monthHeading()).toBe('October 2026')

        fireEvent.click(cell('2026-10-01'))

        expect(cell('2026-10-01')).toHaveAttribute('aria-pressed', 'true')
        expect(await screen.findByTestId('day-details')).toBeInTheDocument()
        expect(text(screen.getByTestId('day-details'))).toContain(
          '2 activities · 16.8 km · 1h 14m'
        )
      })

      it('clears a day outside the range once a retry loads that range', async () => {
        renderDashboard()
        await waitForLoaded()
        mockedSummary.mockRejectedValueOnce(
          new ApiRequestError('Service Unavailable', 503)
        )
        // Year to date stays on screen; October is the applied range.
        fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
        const alert = await screen.findByRole('alert')
        fireEvent.click(cell('2026-09-24'))
        expect(cell('2026-09-24')).toHaveAttribute('aria-pressed', 'true')
        await screen.findByTestId('day-details')

        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

        await waitFor(() => expect(monthHeading()).toBe('October 2026'))
        await waitFor(() =>
          expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        )
        expect(screen.queryByTestId('day-details')).not.toBeInTheDocument()
      })

      it('keeps a day that the retried range also contains', async () => {
        renderDashboard()
        await waitForLoaded()
        mockedSummary.mockRejectedValueOnce(
          new ApiRequestError('Service Unavailable', 503)
        )
        fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
        const alert = await screen.findByRole('alert')
        fireEvent.click(cell('2026-10-01'))
        await screen.findByTestId('day-details')

        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

        await waitFor(() => expect(monthHeading()).toBe('October 2026'))
        await waitFor(() =>
          expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        )
        expect(cell('2026-10-01')).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByTestId('day-details')).toBeInTheDocument()
      })

      it('clears a day outside the range when the failed range is stepped to and loads', async () => {
        await failSecondRange()
        fireEvent.click(cell('2025-10-01'))
        await screen.findByTestId('day-details')

        // Previous year targets the failed 2024 again; this time it loads.
        fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))

        await waitFor(() => expect(shownDates()).toBe('1 Jan – 31 Dec 2024'))
        await waitFor(() =>
          expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        )
        expect(screen.queryByTestId('day-details')).not.toBeInTheDocument()
      })

      it('does not bring the day back when its range is opened again', async () => {
        await failSecondRange()
        fireEvent.click(cell('2025-10-01'))
        await screen.findByTestId('day-details')
        fireEvent.click(
          within(screen.getByRole('alert')).getByRole('button', {
            name: 'Retry'
          })
        )
        await waitFor(() => expect(shownDates()).toBe('1 Jan – 31 Dec 2024'))
        await waitForLoaded()
        await waitFor(() =>
          expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        )

        fireEvent.click(screen.getByRole('button', { name: 'Next year' }))

        await waitFor(() => expect(shownDates()).toBe('1 Jan – 31 Dec 2025'))
        await waitForLoaded()
        expect(cell('2025-10-01')).toHaveAttribute('aria-pressed', 'false')
        expect(screen.queryByTestId('day-details')).not.toBeInTheDocument()
      })

      it('keeps the day while a retry that fails again leaves the previous results', async () => {
        await failSecondRange()
        fireEvent.click(cell('2025-10-01'))
        await screen.findByTestId('day-details')
        mockedSummary.mockRejectedValueOnce(
          new ApiRequestError('Service Unavailable', 503)
        )

        fireEvent.click(
          within(screen.getByRole('alert')).getByRole('button', {
            name: 'Retry'
          })
        )

        await waitFor(() => expect(mockedSummary).toHaveBeenCalledTimes(4))
        await screen.findByRole('alert')
        expect(cell('2025-10-01')).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByTestId('day-details')).toBeInTheDocument()
      })
    })
  })
})
