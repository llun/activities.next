/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { memo } from 'react'

import { ApiRequestError } from '@/lib/client'
import type { AnnualYearRowProps } from '@/lib/components/fitness/calendar/AnnualYearRow'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { createDeferred } from '@/lib/testing/deferred'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'

import {
  ActorFitnessDashboard,
  INLINE_DETAILS_MIN_WIDTH
} from './ActorFitnessDashboard'
import {
  ACTOR_ID,
  CURRENT_TIME,
  calendarDays,
  cell,
  lastRange,
  mockedCalendar,
  mockedDay,
  mockedSummary,
  monthHeading,
  phoneHeading,
  rangeTrigger,
  renderDashboard,
  setUpDashboardTest,
  shownDates,
  stubDashboardWidth,
  summary,
  tearDownDashboardTest,
  text,
  waitForLoaded
} from './ActorFitnessDashboard.testUtils'
import { OverviewHeaderSlot } from './FitnessOverviewHeader'

vi.mock('next/link', async () => ({
  default: (await import('./ActorFitnessDashboard.mocks')).MockLink
}))

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

// Counts the annual calendar's year-row renders, split into the last row (the
// one given the legend as `trailing`) and the others. The wrapper is memoized
// like the real row, so a count is a render the real row's memo let through.
const yearRowRenders = vi.hoisted(() => ({ last: 0, others: 0 }))

vi.mock(
  '@/lib/components/fitness/calendar/AnnualYearRow',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/components/fitness/calendar/AnnualYearRow')
      >()
    const Real = actual.AnnualYearRow
    return {
      ...actual,
      AnnualYearRow: memo(function CountingAnnualYearRow(
        props: AnnualYearRowProps
      ) {
        if (props.trailing === undefined) yearRowRenders.others += 1
        else yearRowRenders.last += 1
        return <Real {...props} />
      })
    }
  }
)

describe('ActorFitnessDashboard', () => {
  beforeEach(() => {
    setUpDashboardTest()
  })

  afterEach(() => {
    tearDownDashboardTest()
  })

  it('renders a dateless skeleton on the server and hydrates it without a mismatch', async () => {
    const { serverHtml, container, onRecoverableError, unmount } =
      await hydrateServerHtml(
        <ActorFitnessDashboard actorId={ACTOR_ID} currentTime={CURRENT_TIME} />
      )
    try {
      // The server cannot know the viewer's days: no year, no month, no range.
      expect(serverHtml).toContain('fitness-overview-skeleton')
      expect(serverHtml).not.toMatch(/2026|Oct|Jan|Year to date/)
      // The heading placeholder stands in for the compact header only: from
      // the width where the overview moves it into the page header it is
      // hidden, so the summary strip does not jump on hydration.
      expect(serverHtml).toContain(
        `@min-[${INLINE_DETAILS_MIN_WIDTH}px]:hidden`
      )
      expect(onRecoverableError).not.toHaveBeenCalled()

      // The first client render after hydration switches to the real overview.
      await waitFor(() =>
        expect(
          container.querySelector('[data-testid="fitness-overview"]')
        ).not.toBeNull()
      )
      expect(container.textContent).toContain('1 Jan – 4 Oct 2026')
    } finally {
      unmount()
    }
  })

  it('requests year to date through today in the viewer zone by default', async () => {
    renderDashboard()

    await waitFor(() => expect(mockedSummary).toHaveBeenCalled())
    const expected = {
      actorId: ACTOR_ID,
      from: '2026-01-01',
      to: '2026-10-04',
      timeZone: 'UTC',
      signal: expect.any(AbortSignal)
    }
    expect(mockedSummary).toHaveBeenCalledWith(expected)
    expect(mockedCalendar).toHaveBeenCalledWith(expected)
    // The overview never narrows by the feed's `?activity=` filter.
    expect(Object.hasOwn(mockedCalendar.mock.calls[0][0], 'activityType')).toBe(
      false
    )
    expect(shownDates()).toBe('1 Jan – 4 Oct 2026')
    expect(rangeTrigger()).toHaveAccessibleName('Date range: Year to date')
  })

  it("derives today from the server clock in the viewer's own zone", async () => {
    // Fake timers replace `Intl.DateTimeFormat`, and the zone is stubbed on the
    // real one; this test reads no clock but the `currentTime` it passes.
    vi.useRealTimers()
    const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions
    vi.spyOn(
      Intl.DateTimeFormat.prototype,
      'resolvedOptions'
    ).mockImplementation(function (this: Intl.DateTimeFormat) {
      const real = realResolvedOptions.call(this)
      return real.timeZone === 'UTC'
        ? { ...real, timeZone: 'Pacific/Auckland' }
        : real
    })

    // 12:00 UTC on 4 October 2026 is 01:00 on the 5th in Auckland (NZDT).
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={Date.UTC(2026, 9, 4, 12)}
      />
    )

    await waitFor(() =>
      expect(mockedSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '2026-01-01',
          to: '2026-10-05',
          timeZone: 'Pacific/Auckland'
        })
      )
    )
  })

  it('moves today forward when the page regains focus after midnight', async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 4, 23, 59))
    render(
      <ActorFitnessDashboard
        actorId={ACTOR_ID}
        currentTime={Date.UTC(2026, 9, 4, 23, 59)}
      />
    )
    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2026-01-01',
        to: '2026-10-04'
      })
    )

    vi.setSystemTime(Date.UTC(2026, 9, 5, 0, 1))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(shownDates()).toBe('1 Jan – 5 Oct 2026')
    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2026-01-01',
        to: '2026-10-05'
      })
    )
  })

  it('keeps the grid and says so when the range has no activity', async () => {
    mockedSummary.mockResolvedValue([])
    mockedCalendar.mockResolvedValue([])
    renderDashboard()

    expect(
      await screen.findByText(/No activities recorded in 1 Jan – 4 Oct 2026/)
    ).toBeInTheDocument()
    // The calendar's structure stays: today is still a selectable cell.
    expect(cell('2026-10-04')).toBeEnabled()
    expect(cell('2026-10-04')).toHaveAccessibleName(
      'Sunday, 4 October 2026: No activities'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the previous results, labelled, when a new range fails, and retries it', async () => {
    renderDashboard()
    await waitFor(() =>
      expect(screen.getByText('Activities', { selector: 'dt' })).toBeVisible()
    )
    await waitForLoaded()

    mockedSummary.mockRejectedValueOnce(
      new ApiRequestError('Service Unavailable', 503)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))

    const alert = await screen.findByRole('alert')
    expect(text(alert)).toContain(
      'Showing previous results for 1 Jan – 4 Oct 2026'
    )
    expect(text(alert)).toContain('We couldn’t load 1 Jan – 31 Dec 2025')
    // Friendly copy, never the reason the read failed.
    expect(text(alert)).toContain('Check your connection and try again.')
    expect(text(alert)).not.toContain('Service Unavailable')
    expect(text(alert)).toContain('from the previous range')
    // Everything on screen describes the data on screen: the dates, the
    // picker and the toolbar stay on the previous range, and the numbers are
    // that range's, never zeros. Only the banner names the failed one.
    expect(shownDates()).toBe('1 Jan – 4 Oct 2026')
    expect(rangeTrigger()).toHaveAccessibleName('Date range: Year to date')
    expect(
      screen.getByRole('button', { name: 'Calendar year: 2026' })
    ).toBeInTheDocument()
    expect(
      text(
        screen
          .getByText('Activities', { selector: 'dt' })
          .parentElement?.querySelector('dd') ?? null
      )
    ).toBe('4')

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(lastRange(mockedSummary)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31'
    })
    expect(shownDates()).toBe('1 Jan – 31 Dec 2025')
  })

  it('never shows a failed first read as an empty range', async () => {
    mockedCalendar.mockRejectedValue(new ApiRequestError('Bad Gateway', 502))
    renderDashboard()

    const alert = await screen.findByRole('alert')
    expect(text(alert)).toContain('We couldn’t load 1 Jan – 4 Oct 2026')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByText(/No activities recorded/)).not.toBeInTheDocument()
    expect(
      screen
        .getByText('Activities', { selector: 'dt' })
        .parentElement?.querySelector('dd')
    ).toHaveTextContent('Unavailable')
  })

  it.each([
    ['an HTTP failure body', new ApiRequestError('boom', 500)],
    ['the browser’s own words', new TypeError('Failed to fetch')]
  ])('never shows raw error text from %s', async (_name, error) => {
    mockedCalendar.mockRejectedValue(error)
    renderDashboard()

    const alert = await screen.findByRole('alert')
    expect(text(alert)).toContain('We couldn’t load 1 Jan – 4 Oct 2026')
    expect(text(alert)).toContain(
      'Check your connection and try again. Nothing is shown for this range until it loads.'
    )
    // Named once: the alert is announced, and a repeated sentence is heard twice.
    expect(text(alert)?.match(/We couldn’t load/g)).toHaveLength(1)
    expect(text(alert)).not.toMatch(/boom|Failed to fetch/)
  })

  it('offers a Choose a range button on an empty range, which opens the picker', async () => {
    mockedSummary.mockResolvedValue([])
    mockedCalendar.mockResolvedValue([])
    renderDashboard()

    const choose = await screen.findByRole('button', { name: 'Choose a range' })
    expect(screen.queryByRole('dialog', { name: 'Date range' })).toBeNull()

    fireEvent.click(choose)

    expect(rangeTrigger()).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByLabelText('From')).toBeInTheDocument()
  })

  describe('year controls', () => {
    const applyPreset = async (name: string) => {
      fireEvent.click(rangeTrigger())
      fireEvent.click(await screen.findByRole('button', { name }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      await waitFor(() =>
        expect(rangeTrigger()).not.toHaveAttribute('aria-expanded', 'true')
      )
    }

    it('shows the year chooser and year arrows for year to date', () => {
      renderDashboard()

      expect(
        screen.getByRole('button', { name: 'Calendar year: 2026' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Previous year' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Next year' })
      ).toBeInTheDocument()
    })

    it('shows only Month view for Last 12 months', async () => {
      renderDashboard()
      await applyPreset('Last 12 months')
      await waitForLoaded()

      expect(rangeTrigger()).toHaveAccessibleName('Date range: Last 12 months')
      expect(screen.queryByRole('button', { name: /Calendar year/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Previous year' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Next year' })).toBeNull()
      expect(
        screen.getByRole('button', { name: /Month view/ })
      ).toBeInTheDocument()
    })

    it('shows only Month view for a custom range across years', async () => {
      renderDashboard()
      fireEvent.click(rangeTrigger())
      fireEvent.click(await screen.findByRole('button', { name: 'Custom' }))
      fireEvent.change(screen.getByLabelText('From'), {
        target: { value: '2024-03-15' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      await waitFor(() =>
        expect(rangeTrigger()).toHaveAccessibleName('Date range: Custom range')
      )

      expect(screen.queryByRole('button', { name: /Calendar year/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Previous year' })).toBeNull()
      expect(
        screen.getByRole('button', { name: /Month view/ })
      ).toBeInTheDocument()
    })
  })

  it('writes the current month’s dates with the month once: 1 – 4 Oct 2026', async () => {
    renderDashboard()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))

    expect(monthHeading()).toBe('October 2026')
    expect(shownDates()).toBe('1 – 4 Oct 2026')
  })

  it('lists the activity types below the calendar with their filter links', async () => {
    renderDashboard({ selectedActivityType: 'run' })

    const run = await screen.findByRole('link', { name: 'Run' })
    expect(run).toHaveAttribute('href', '/fitness')
    expect(run).toHaveAttribute('aria-current', 'true')
    // Untyped activities count, on a row that is not a filter.
    expect(screen.getByText('Workout').closest('a')).toBeNull()

    const calendarHeading = screen.getByRole('heading', {
      name: 'Training calendar'
    })
    const typesHeading = screen.getByRole('heading', { name: 'Activity types' })
    expect(
      calendarHeading.compareDocumentPosition(typesHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('opens a month from its label and goes back to the same year', async () => {
    renderDashboard()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Show September 2026' }))

    expect(monthHeading()).toBe('September 2026')
    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2026-09-01',
        to: '2026-09-30'
      })
    )
    expect(
      await screen.findByRole('group', { name: 'September 2026' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Back to year/ }))

    expect(shownDates()).toBe('1 Jan – 4 Oct 2026')
    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2026-01-01',
        to: '2026-10-04'
      })
    )
  })

  it('disables the steps that would land wholly in the future', async () => {
    renderDashboard()

    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))

    // The latest month of year to date is the current month.
    expect(monthHeading()).toBe('October 2026')
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(monthHeading()).toBe('September 2026')
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  it('scrolls the page just far enough to bring inline details into view', async () => {
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    vi.stubGlobal('innerHeight', 700)
    renderDashboard()
    await waitForLoaded()
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
    await screen.findByTestId('day-details')

    // Bringing the details into view would take 1100 - (700 - 16) = 416px, but
    // that would push the pinned cell (top 300) above the sticky header's room
    // (64px), so the page moves only 300 - 64 = 236px.
    await waitFor(() =>
      expect(scrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 236 })
      )
    )
    expect(scrollBy).toHaveBeenCalledTimes(1)
  })

  it('re-reads the range and the open day from Refresh while it loads', async () => {
    renderDashboard()
    await waitForLoaded()
    fireEvent.click(cell('2026-10-01'))
    const details = await screen.findByTestId('day-details')
    expect(await within(details).findByText('Morning run')).toBeInTheDocument()
    const summaryCalls = mockedSummary.mock.calls.length
    const calendarCalls = mockedCalendar.mock.calls.length
    const dayCalls = mockedDay.mock.calls.length

    let release: () => void = () => {}
    mockedSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(summary)
        })
    )
    const refresh = screen.getByRole('button', {
      name: 'Refresh fitness overview'
    })
    fireEvent.click(refresh)

    expect(mockedSummary).toHaveBeenCalledTimes(summaryCalls + 1)
    expect(mockedCalendar).toHaveBeenCalledTimes(calendarCalls + 1)
    expect(mockedDay).toHaveBeenCalledTimes(dayCalls + 1)
    expect(mockedDay).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: '2026-10-01' })
    )
    // Busy, but still focusable: a second press does nothing.
    expect(refresh).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(refresh)
    expect(mockedSummary).toHaveBeenCalledTimes(summaryCalls + 1)

    await act(async () => release())
    await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled'))
  })

  it('keeps the range, day, metric and view across a resize to the phone sheet', async () => {
    const viewport = stubDashboardWidth(908)
    renderDashboard()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Distance' }))
    await waitForLoaded()
    fireEvent.click(cell('2026-10-01'))
    expect(await screen.findByTestId('day-details')).toBeInTheDocument()
    const summaryCalls = mockedSummary.mock.calls.length

    viewport.resize(INLINE_DETAILS_MIN_WIDTH - 210)

    const sheet = await screen.findByTestId('day-details-sheet')
    expect(screen.queryByTestId('day-details')).not.toBeInTheDocument()
    expect(
      within(sheet).getByRole('heading', { name: 'Thursday, 1 October 2026' })
    ).toBeInTheDocument()
    // The phone placement: the month heads the period block above the totals.
    expect(phoneHeading()).toBe('October 2026')
    expect(screen.queryByTestId('month-heading-row')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Distance' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(cell('2026-10-01')).toHaveAttribute('aria-pressed', 'true')
    expect(mockedSummary).toHaveBeenCalledTimes(summaryCalls)

    // The sheet's height pads the page's scroll, and the selected day is
    // scrolled clear of it.
    await waitFor(() =>
      expect(document.documentElement.style.scrollPaddingBottom).toBe('256px')
    )
    expect(cell('2026-10-01').scrollIntoView).toHaveBeenCalled()

    viewport.resize(908)
    expect(await screen.findByTestId('day-details')).toBeInTheDocument()
    expect(screen.queryByTestId('day-details-sheet')).not.toBeInTheDocument()
    expect(monthHeading()).toBe('October 2026')
    expect(document.documentElement.style.scrollPaddingBottom).toBe('')
  })

  it('offers a day list in place of the month grid where cells would be under 44px', async () => {
    const viewport = stubDashboardWidth(320)
    renderDashboard()
    await waitForLoaded()
    expect(
      screen.queryByRole('group', { name: 'Show the month as' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
    const toggle = screen.getByRole('group', { name: 'Show the month as' })
    fireEvent.click(within(toggle).getByRole('button', { name: 'List' }))

    expect(
      await screen.findByRole('list', { name: 'October 2026, day by day' })
    ).toBeInTheDocument()

    // Wider again: the grid comes back, the month is unchanged.
    viewport.resize(700)
    expect(
      screen.queryByRole('list', { name: 'October 2026, day by day' })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole('group', { name: 'October 2026' })
    ).toBeInTheDocument()
  })

  it('lays the controls out as the wide designs do: dates and Range in the page header, steps in the toolbar', async () => {
    render(
      <>
        <header data-testid="page-header">
          <h1>Overview</h1>
          <OverviewHeaderSlot slot="dates" />
          <OverviewHeaderSlot slot="range" />
        </header>
        <ActorFitnessDashboard actorId={ACTOR_ID} currentTime={CURRENT_TIME} />
      </>
    )
    await waitForLoaded()

    const pageHeader = screen.getByTestId('page-header')
    expect(
      within(pageHeader).getByTestId('fitness-overview-dates')
    ).toHaveTextContent('1 Jan – 4 Oct 2026')
    expect(pageHeader).toContainElement(rangeTrigger())
    expect(
      screen.queryByTestId('fitness-overview-header')
    ).not.toBeInTheDocument()

    const toolbar = screen.getByTestId('training-calendar-toolbar')
    expect(
      within(toolbar).getByRole('button', { name: 'Calendar year: 2026' })
    ).toBeInTheDocument()
    expect(
      within(toolbar).getByRole('button', { name: 'Previous year' })
    ).toBeEnabled()
    expect(
      within(toolbar).getByRole('button', { name: 'Next year' })
    ).toBeDisabled()

    fireEvent.click(within(toolbar).getByRole('button', { name: /Month view/ }))

    // Month view: Back to year and the arrows move to the month's own row,
    // which is exactly as wide as the grid; the toolbar keeps only its title.
    expect(within(toolbar).queryAllByRole('button')).toHaveLength(0)
    const monthRow = screen.getByTestId('month-heading-row')
    expect(
      within(monthRow).getByRole('button', { name: /Back to year/ })
    ).toBeInTheDocument()
    expect(
      within(monthRow).getByRole('button', { name: 'Previous month' })
    ).toBeEnabled()
    expect(monthRow.style.maxWidth).toContain('100cqw')
    expect(rangeTrigger()).toHaveAccessibleName('Date range: This month')
  })

  it('lays the controls out as the phone designs do on a narrow container', async () => {
    stubDashboardWidth(358)
    renderDashboard()
    await waitForLoaded()

    const header = screen.getByTestId('fitness-overview-header')
    expect(phoneHeading()).toBe('2026 · Year to date')
    expect(
      within(header).getByRole('button', { name: 'Previous year' })
    ).toBeEnabled()
    expect(header).toContainElement(rangeTrigger())

    const toolbar = screen.getByTestId('training-calendar-toolbar')
    expect(
      within(toolbar).queryByRole('button', { name: /Calendar year/ })
    ).not.toBeInTheDocument()
    fireEvent.click(within(toolbar).getByRole('button', { name: /Month view/ }))

    expect(phoneHeading()).toBe('October 2026')
    expect(
      within(screen.getByTestId('training-calendar-toolbar')).getByRole(
        'button',
        { name: /Back to year/ }
      )
    ).toBeInTheDocument()
    expect(screen.queryByTestId('month-heading-row')).not.toBeInTheDocument()
  })

  it('applies a calendar year from the toolbar year chooser', async () => {
    renderDashboard()
    await waitForLoaded()

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Calendar year: 2026' }),
      { button: 0, pointerType: 'mouse' }
    )
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '2024' }))

    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2024-01-01',
        to: '2024-12-31'
      })
    )
    expect(rangeTrigger()).toHaveAccessibleName('Date range: Year 2024')
  })

  it('paints a new data set at once and fades only a change to the same cells', async () => {
    const calendar = createDeferred<FitnessCalendarDay[]>()
    mockedCalendar.mockReturnValueOnce(calendar.promise)
    renderDashboard()
    const region = screen.getByTestId('calendar-region')

    // Loading, then the first data set: no fade from the skeleton's grey.
    expect(region).toHaveAttribute('data-instant-colour', 'true')
    await act(async () => calendar.resolve(calendarDays))
    await waitForLoaded()
    expect(region).toHaveAttribute('data-instant-colour', 'true')
    expect(region.style.getPropertyValue('--fitness-t-color')).toBe('0ms')

    // Once it has painted, the same cells fade on a metric switch.
    await waitFor(() =>
      expect(region).not.toHaveAttribute('data-instant-colour')
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Distance' }))
    expect(region).not.toHaveAttribute('data-instant-colour')
    expect(region.style.getPropertyValue('--fitness-t-color')).toBe('')

    // A new range is a new data set: instant again.
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(screen.getByTestId('calendar-region')).toHaveAttribute(
      'data-instant-colour',
      'true'
    )
  })

  it('never announces a day as a rest day while its range is still loading', async () => {
    const first = createDeferred<FitnessCalendarDay[]>()
    mockedCalendar.mockReturnValueOnce(first.promise)
    renderDashboard()

    // The first read is pending: the grid has no data, so a day with
    // activities must not be called a rest day.
    expect(cell('2026-09-24')).toHaveAttribute(
      'aria-label',
      'Thursday, 24 September 2026: Loading'
    )
    expect(document.querySelector('[aria-label$="No activities"]')).toBeNull()

    await act(async () => first.resolve(calendarDays))
    await waitForLoaded()
    expect(cell('2026-09-24')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('1 activity')
    )

    // A later read is loading again, and says so for every day it draws.
    const second = createDeferred<FitnessCalendarDay[]>()
    mockedCalendar.mockReturnValueOnce(second.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(document.querySelector('[aria-label$="No activities"]')).toBeNull()
    expect(cell('2025-09-24')).toHaveAttribute(
      'aria-label',
      'Wednesday, 24 September 2025: Loading'
    )
  })

  it('re-derives today at once when the viewer zone changes, without waiting for another focus', async () => {
    // As in the zone test above: the zone is stubbed on the real
    // `Intl.DateTimeFormat`, and the clock is read from Date.now.
    vi.useRealTimers()
    const at = Date.UTC(2026, 9, 4, 12)
    vi.spyOn(Date, 'now').mockReturnValue(at)
    let zone = 'UTC'
    const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions
    vi.spyOn(
      Intl.DateTimeFormat.prototype,
      'resolvedOptions'
    ).mockImplementation(function (this: Intl.DateTimeFormat) {
      const real = realResolvedOptions.call(this)
      return { ...real, timeZone: zone }
    })
    render(<ActorFitnessDashboard actorId={ACTOR_ID} currentTime={at} />)
    await waitFor(() =>
      expect(mockedSummary).toHaveBeenCalledWith(
        expect.objectContaining({ to: '2026-10-04', timeZone: 'UTC' })
      )
    )

    // A traveller lands in Auckland, where 12:00 UTC is already the 5th; the
    // browser reports it on the next focus, and only that one focus happens.
    zone = 'Pacific/Auckland'
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() =>
      expect(mockedSummary).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: '2026-01-01',
          to: '2026-10-05',
          timeZone: 'Pacific/Auckland'
        })
      )
    )
    expect(shownDates()).toBe('1 Jan – 5 Oct 2026')
  })

  it('does not redraw the year rows while the picker draft is edited', async () => {
    renderDashboard()
    await waitForLoaded()
    // A custom range across four calendar years: four year rows.
    fireEvent.click(rangeTrigger())
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2023-01-01' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(lastRange(mockedSummary)).toEqual({
        from: '2023-01-01',
        to: '2026-10-04'
      })
    )
    await waitForLoaded()
    expect(
      screen.getAllByRole('group', { name: /^Training calendar, \d{4}$/ })
    ).toHaveLength(4)

    fireEvent.click(rangeTrigger())
    const from = await screen.findByLabelText('From')
    const before = { ...yearRowRenders }
    for (const value of [
      '2024-03-1',
      '2024-03-15',
      '2024-03-1',
      '2024-03-12'
    ]) {
      fireEvent.change(from, { target: { value } })
    }

    // Each edit changes the overview state, and nothing a year row reads.
    expect(yearRowRenders.others - before.others).toBe(0)
    expect(yearRowRenders.last - before.last).toBe(0)
  })

  it('makes the calendar inert and hidden when the first read failed', async () => {
    mockedCalendar.mockRejectedValue(new ApiRequestError('Bad Gateway', 502))
    renderDashboard()
    await screen.findByRole('alert')

    const region = screen.getByTestId('calendar-region')
    expect(region).toHaveAttribute('inert')
    expect(region).toHaveAttribute('aria-hidden', 'true')
  })

  it('leaves the calendar operable once it has loaded', async () => {
    renderDashboard()
    await waitForLoaded()

    const region = screen.getByTestId('calendar-region')
    expect(region).not.toHaveAttribute('inert')
    expect(region).not.toHaveAttribute('aria-hidden')
  })

  it('relabels the legend when the metric changes', async () => {
    renderDashboard()
    await waitForLoaded()
    expect(
      screen.getByRole('list', { name: 'Legend: activities per day' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Distance' }))

    expect(
      screen.getByRole('list', { name: 'Legend: distance per day' })
    ).toBeInTheDocument()
  })

  it('shows the Upcoming legend swatch for this month only, not for a past month', async () => {
    renderDashboard()
    await waitForLoaded()
    expect(screen.queryByText('Upcoming')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
    expect(await screen.findByText('Upcoming')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(monthHeading()).toBe('September 2026')
    await waitForLoaded()
    expect(screen.queryByText('Upcoming')).toBeNull()
  })

  it('captions the month footer through today, and gives a past month its dates', async () => {
    renderDashboard()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))
    expect(
      await screen.findByText(/Activity through 4 Oct/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(monthHeading()).toBe('September 2026')
    await waitForLoaded()
    expect(screen.queryByText(/Activity through/)).toBeNull()
    expect(screen.getAllByText(/1 – 30 Sep 2026/).length).toBeGreaterThan(0)
  })

  it('marks the grid busy while the range reads', async () => {
    const busy = () =>
      document.querySelector('[data-slot="annual-calendar"] [aria-busy="true"]')
    const calendar = createDeferred<FitnessCalendarDay[]>()
    mockedCalendar.mockReturnValueOnce(calendar.promise)
    renderDashboard()
    expect(busy()).not.toBeNull()
    await act(async () => calendar.resolve(calendarDays))
    await waitFor(() => expect(busy()).toBeNull())
  })

  it('keeps the grid busy when the first read fails', async () => {
    mockedCalendar.mockRejectedValueOnce(new Error('boom'))
    renderDashboard()
    await screen.findByRole('alert')
    expect(
      document.querySelector('[data-slot="annual-calendar"] [aria-busy="true"]')
    ).not.toBeNull()
  })

  it('opens the month as a grid at 320px and offers the list as a choice', async () => {
    stubDashboardWidth(320)
    renderDashboard()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: /Month view/ }))

    const toggle = screen.getByRole('group', { name: 'Show the month as' })
    expect(
      within(toggle).getByRole('button', { name: 'Grid' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(toggle).getByRole('button', { name: 'List' })
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('group', { name: 'October 2026' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'October 2026, day by day' })
    ).not.toBeInTheDocument()
  })

  it.each([
    [INLINE_DETAILS_MIN_WIDTH, 'day-details'],
    [INLINE_DETAILS_MIN_WIDTH - 1, 'day-details-sheet']
  ])('places the day details for a %ipx container as %s', async (width, id) => {
    stubDashboardWidth(width)
    renderDashboard()
    await waitForLoaded()

    fireEvent.click(cell('2026-10-01'))

    expect(await screen.findByTestId(id)).toBeInTheDocument()
  })
})
