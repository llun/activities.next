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
import { AnchorHTMLAttributes, ReactNode } from 'react'

import {
  ApiRequestError,
  getFitnessCalendarData,
  getFitnessCalendarDayActivities,
  getFitnessSummary
} from '@/lib/client'
import type {
  FitnessActivitySummary,
  FitnessCalendarDay,
  FitnessDayActivitiesPage
} from '@/lib/fitness/calendar/types'
import { createDeferred } from '@/lib/testing/deferred'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'

import {
  ActorFitnessDashboard,
  INLINE_DETAILS_MIN_WIDTH
} from './ActorFitnessDashboard'
import { OverviewHeaderSlot } from './FitnessOverviewHeader'

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

// next/link swallows `prefetch` and `scroll` instead of reflecting them in the
// DOM, so render them ourselves to assert on them.
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

const mockedSummary = vi.mocked(getFitnessSummary)
const mockedCalendar = vi.mocked(getFitnessCalendarData)
const mockedDay = vi.mocked(getFitnessCalendarDayActivities)

const ACTOR_ID = 'https://activities.local/users/llun'
// Sunday 4 October 2026, 10:00 UTC. The suite runs in UTC, so the viewer's
// zone is UTC unless a test says otherwise.
const CURRENT_TIME = Date.UTC(2026, 9, 4, 10)

const summary: FitnessActivitySummary[] = [
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
]

const calendarDays: FitnessCalendarDay[] = [
  {
    date: '2026-10-01',
    count: 2,
    totalDistanceMeters: 16800,
    totalDurationSeconds: 4440,
    totalElevationGainMeters: 80
  },
  {
    date: '2026-09-24',
    count: 1,
    totalDistanceMeters: 5000,
    totalDurationSeconds: 1800,
    totalElevationGainMeters: 40
  }
]

const dayPage = (date: string): FitnessDayActivitiesPage => ({
  date,
  timeZone: 'UTC',
  activities: [
    {
      id: `${date}-a`,
      activityType: 'run',
      startTime: Date.parse(`${date}T07:05:00Z`),
      totalDistanceMeters: 9600,
      totalDurationSeconds: 1980,
      elevationGainMeters: 40,
      title: 'Morning run',
      statusPath: '/@llun/1'
    }
  ],
  hasMore: false,
  nextOffset: 1
})

const renderDashboard = (props: { selectedActivityType?: string } = {}) =>
  render(
    <ActorFitnessDashboard
      actorId={ACTOR_ID}
      currentTime={CURRENT_TIME}
      earliestActivityTime={Date.UTC(2023, 4, 1)}
      {...props}
    />
  )

const text = (element: Element | null) =>
  element?.textContent?.replace(/\u00a0/g, ' ')

/** The exact dates of the range on screen. */
const shownDates = () => text(screen.getByTestId('fitness-overview-dates'))

/** The range picker trigger's name, which names the range on screen. */
const rangeTrigger = () => screen.getByTestId('range-picker-trigger')

/** The period heading of the narrow-container (phone) header. */
const phoneHeading = () =>
  text(
    within(screen.getByTestId('fitness-overview-header')).getByRole('heading', {
      level: 2
    })
  )

/** The month heading row's month (wide containers, month view). */
const monthHeading = () =>
  text(
    within(screen.getByTestId('month-heading-row')).getByRole('heading', {
      level: 3
    })
  )

const lastRange = (mock: typeof mockedSummary | typeof mockedCalendar) => {
  const call = mock.mock.calls[mock.mock.calls.length - 1]?.[0]
  return call ? { from: call.from, to: call.to } : null
}

const cell = (date: string) => {
  const element = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (!element) throw new Error(`No cell for ${date}`)
  return element
}

const waitForLoaded = () =>
  waitFor(() =>
    expect(
      document.querySelector('[data-slot$="-calendar"] [aria-busy="true"]')
    ).toBeNull()
  )

/** Gives the dashboard root a width, and a ResizeObserver that can change it. */
const stubDashboardWidth = (initial: number) => {
  let width = initial
  const observers = new Set<{
    callback: ResizeObserverCallback
    targets: Set<Element>
    observer: ResizeObserver
  }>()
  class ResizeObserverStub {
    private readonly entry
    constructor(callback: ResizeObserverCallback) {
      this.entry = {
        callback,
        targets: new Set<Element>(),
        observer: this as unknown as ResizeObserver
      }
      observers.add(this.entry)
    }
    observe(target: Element) {
      this.entry.targets.add(target)
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target)
    }
    disconnect() {
      observers.delete(this.entry)
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  const isRoot = (element: Element) =>
    element.getAttribute('data-testid') === 'fitness-overview'
  const isSheet = (element: Element) =>
    element.getAttribute('data-testid') === 'day-details-sheet'
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const w = isRoot(this) ? width : 0
      const h = isSheet(this) ? 240 : 0
      return {
        width: w,
        height: h,
        left: 0,
        top: 0,
        right: w,
        bottom: h,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    }
  )
  return {
    resize(next: number) {
      width = next
      act(() => {
        for (const { callback, targets, observer } of observers) {
          for (const target of targets) {
            if (!isRoot(target)) continue
            callback(
              [{ target, contentRect: { width: next } } as ResizeObserverEntry],
              observer
            )
          }
        }
      })
    }
  }
}

describe('ActorFitnessDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(CURRENT_TIME)
    mockedSummary.mockReset()
    mockedCalendar.mockReset()
    mockedDay.mockReset()
    mockedSummary.mockResolvedValue(summary)
    mockedCalendar.mockResolvedValue(calendarDays)
    mockedDay.mockImplementation(async ({ date }) => dayPage(date))
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.documentElement.style.scrollPaddingBottom = ''
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
    expect(text(alert)).toContain('Service Unavailable')
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
})
