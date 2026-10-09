import { act, render, screen, waitFor, within } from '@testing-library/react'
import { expect, vi } from 'vitest'

import {
  getFitnessCalendarData,
  getFitnessCalendarDayActivities,
  getFitnessSummary
} from '@/lib/client'
import type {
  FitnessActivitySummary,
  FitnessCalendarDay,
  FitnessDayActivitiesPage
} from '@/lib/fitness/calendar/types'

import { ActorFitnessDashboard } from './ActorFitnessDashboard'

export const mockedSummary = vi.mocked(getFitnessSummary)
export const mockedCalendar = vi.mocked(getFitnessCalendarData)
export const mockedDay = vi.mocked(getFitnessCalendarDayActivities)

export const ACTOR_ID = 'https://activities.local/users/llun'
// Sunday 4 October 2026, 10:00 UTC. The suite runs in UTC, so the viewer's
// zone is UTC unless a test says otherwise.
export const CURRENT_TIME = Date.UTC(2026, 9, 4, 10)

export const summary: FitnessActivitySummary[] = [
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

export const calendarDays: FitnessCalendarDay[] = [
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

export const dayPage = (date: string): FitnessDayActivitiesPage => ({
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

export const renderDashboard = (
  props: { selectedActivityType?: string } = {}
) =>
  render(
    <ActorFitnessDashboard
      actorId={ACTOR_ID}
      currentTime={CURRENT_TIME}
      earliestActivityTime={Date.UTC(2023, 4, 1)}
      {...props}
    />
  )

export const text = (element: Element | null) =>
  element?.textContent?.replace(/\u00a0/g, ' ')

/** The exact dates of the range on screen. */
export const shownDates = () =>
  text(screen.getByTestId('fitness-overview-dates'))

/** The range picker trigger's name, which names the range on screen. */
export const rangeTrigger = () => screen.getByTestId('range-picker-trigger')

/** The period heading of the narrow-container (phone) header. */
export const phoneHeading = () =>
  text(
    within(screen.getByTestId('fitness-overview-header')).getByRole('heading', {
      level: 2
    })
  )

/** The month heading row's month (wide containers, month view). */
export const monthHeading = () =>
  text(
    within(screen.getByTestId('month-heading-row')).getByRole('heading', {
      level: 3
    })
  )

export const lastRange = (
  mock: typeof mockedSummary | typeof mockedCalendar
) => {
  const call = mock.mock.calls[mock.mock.calls.length - 1]?.[0]
  return call ? { from: call.from, to: call.to } : null
}

export const cell = (date: string) => {
  const element = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (!element) throw new Error(`No cell for ${date}`)
  return element
}

export const waitForLoaded = () =>
  waitFor(() =>
    expect(
      document.querySelector('[data-slot$="-calendar"] [aria-busy="true"]')
    ).toBeNull()
  )

/** Gives the dashboard root a width, and a ResizeObserver that can change it. */
export const stubDashboardWidth = (initial: number) => {
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

export const setUpDashboardTest = () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(CURRENT_TIME)
  mockedSummary.mockReset()
  mockedCalendar.mockReset()
  mockedDay.mockReset()
  mockedSummary.mockResolvedValue(summary)
  mockedCalendar.mockResolvedValue(calendarDays)
  mockedDay.mockImplementation(async ({ date }) => dayPage(date))
  Element.prototype.scrollIntoView = vi.fn()
}

export const tearDownDashboardTest = () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.scrollPaddingBottom = ''
}
