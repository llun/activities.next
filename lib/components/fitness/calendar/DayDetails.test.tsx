/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DateKey, parseDateKey } from '@/lib/fitness/calendar/localDay'
import { FitnessDayActivity } from '@/lib/fitness/calendar/types'

import {
  DayDetails,
  DayDetailsContentProps,
  formatDayTotals
} from './DayDetails'

// next/link swallows `prefetch` instead of reflecting it in the DOM, so the
// only way to assert on it is to render the prop ourselves.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

const DATE = parseDateKey('2026-09-24') as DateKey

const activity = (
  overrides: Partial<FitnessDayActivity> = {}
): FitnessDayActivity => ({
  id: 'a1',
  activityType: 'road_cycling',
  startTime: Date.parse('2026-09-24T07:05:00Z'),
  totalDistanceMeters: 35200,
  totalDurationSeconds: 4320,
  elevationGainMeters: null,
  title: 'Morning ride',
  statusPath: '/@anna@llun.social/status-1',
  ...overrides
})

const TOTALS = {
  count: 2,
  totalDistanceMeters: 42600,
  totalDurationSeconds: 6840
}

const props = (
  overrides: Partial<DayDetailsContentProps> = {}
): DayDetailsContentProps => ({
  date: DATE,
  timeZone: 'UTC',
  totals: TOTALS,
  activities: [
    activity(),
    activity({
      id: 'a2',
      activityType: 'trail_running',
      title: 'Evening run',
      totalDistanceMeters: 7400,
      totalDurationSeconds: 2520,
      statusPath: '/@anna@llun.social/status-2'
    })
  ],
  loading: false,
  error: false,
  hasMore: false,
  onRetry: vi.fn(),
  onLoadMore: vi.fn(),
  onClose: vi.fn(),
  ...overrides
})

const plain = (text: string) => text.replace(/\u00a0/g, ' ')

describe('formatDayTotals', () => {
  it('joins count, distance and duration', () => {
    expect(plain(formatDayTotals(TOTALS))).toBe(
      '2 activities · 42.6 km · 1h 54m'
    )
  })

  it('reads a single activity and an empty day', () => {
    expect(
      plain(
        formatDayTotals({
          count: 1,
          totalDistanceMeters: 9000,
          totalDurationSeconds: 1440
        })
      )
    ).toBe('1 activity · 9.0 km · 24m')
    expect(formatDayTotals(null)).toBe('0 activities')
    expect(
      formatDayTotals({
        count: 0,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0
      })
    ).toBe('0 activities')
  })
})

describe('DayDetails', () => {
  it('shows the full date, the totals line and real activity rows', () => {
    render(<DayDetails {...props()} />)
    expect(
      screen.getByRole('heading', { name: 'Thursday, 24 September 2026' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('2 activities · 42.6 km · 1h 54m')
    ).toBeInTheDocument()

    const rows = screen.getAllByTestId('day-activity-row')
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByText('Morning ride')).toBeInTheDocument()
    expect(first.getByText(/Road Cycling/)).toBeInTheDocument()
    expect(first.getByText('07:05', { exact: false })).toBeInTheDocument()
    expect(first.getByText('35.2 km')).toBeInTheDocument()
    expect(first.getByText('1h 12m')).toBeInTheDocument()
  })

  it('renders each row time in the viewer zone', () => {
    render(<DayDetails {...props({ timeZone: 'Asia/Tokyo' })} />)
    expect(screen.getAllByText(/16:05/).length).toBeGreaterThan(0)
  })

  it('links rows to their status path without prefetching', () => {
    render(<DayDetails {...props()} />)
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/@anna@llun.social/status-1',
      '/@anna@llun.social/status-2'
    ])
    for (const link of links) {
      expect(link).toHaveAttribute('data-prefetch', 'false')
    }
  })

  it('shows "Linked post unavailable" with no link, and still counts the row', () => {
    render(
      <DayDetails
        {...props({
          totals: { ...TOTALS, count: 3 },
          activities: [
            activity({ id: 'a1' }),
            activity({
              id: 'a2',
              title: null,
              statusPath: null,
              activityType: 'trail_running'
            })
          ]
        })}
      />
    )
    const rows = screen.getAllByTestId('day-activity-row')
    expect(rows).toHaveLength(2)
    const missing = within(rows[1])
    expect(missing.getByText(/Linked post unavailable/)).toBeInTheDocument()
    expect(missing.queryByRole('link')).not.toBeInTheDocument()
    // Named by its type when the post's title is gone.
    expect(missing.getByText('Trail Running')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText(/^3 activities/)).toBeInTheDocument()
  })

  it('says "No recorded activities" for an empty day', () => {
    render(<DayDetails {...props({ totals: null, activities: [] })} />)
    expect(screen.getByText('No recorded activities')).toBeInTheDocument()
    expect(screen.getByText('0 activities')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  describe('loading', () => {
    it('keeps the date and shows a status while the first page loads', () => {
      render(<DayDetails {...props({ activities: [], loading: true })} />)
      expect(
        screen.getByRole('heading', { name: 'Thursday, 24 September 2026' })
      ).toBeInTheDocument()
      expect(screen.getByTestId('day-details-loading')).toHaveAttribute(
        'aria-busy',
        'true'
      )
      expect(screen.getByText('Loading activities')).toBeInTheDocument()
      expect(
        screen.queryByText('No recorded activities')
      ).not.toBeInTheDocument()
    })

    it('keeps the rows already shown while reloading', () => {
      render(<DayDetails {...props({ loading: true })} />)
      expect(screen.getAllByTestId('day-activity-row')).toHaveLength(2)
    })

    it('announces the day once it has loaded, not while loading', () => {
      const { rerender } = render(
        <DayDetails {...props({ activities: [], loading: true })} />
      )
      const live = () =>
        document.querySelector('p[role="status"]') as HTMLElement
      expect(live()).toBeEmptyDOMElement()
      rerender(<DayDetails {...props()} />)
      expect(live()).toHaveTextContent(
        'Thursday, 24 September 2026, 2 activities'
      )
    })
  })

  describe('error', () => {
    it('keeps the selected date, explains the failure and retries', () => {
      const onRetry = vi.fn()
      render(
        <DayDetails {...props({ activities: [], error: true, onRetry })} />
      )
      expect(
        screen.getByRole('heading', { name: 'Thursday, 24 September 2026' })
      ).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent(
        'We couldn’t load the activities for this day.'
      )
      expect(
        screen.queryByText('No recorded activities')
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('keeps already loaded rows when a later page fails', () => {
      render(<DayDetails {...props({ error: true, hasMore: true })} />)
      expect(screen.getAllByTestId('day-activity-row')).toHaveLength(2)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  describe('pagination', () => {
    it('offers Load more only while more rows exist', () => {
      const { rerender } = render(<DayDetails {...props()} />)
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
      const onLoadMore = vi.fn()
      rerender(<DayDetails {...props({ hasMore: true, onLoadMore })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      expect(onLoadMore).toHaveBeenCalledTimes(1)
    })

    it('disables the button while a page is loading', () => {
      render(<DayDetails {...props({ hasMore: true, loadingMore: true })} />)
      expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
    })
  })

  describe('closing', () => {
    it('calls onClose from the Close button', () => {
      const onClose = vi.fn()
      render(<DayDetails {...props({ onClose })} />)
      const close = screen.getByRole('button', { name: 'Close day details' })
      fireEvent.click(close)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on Escape from anywhere inside', () => {
      const onClose = vi.fn()
      render(<DayDetails {...props({ onClose })} />)
      fireEvent.keyDown(screen.getAllByRole('link')[0], { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ignores other keys', () => {
      const onClose = vi.fn()
      render(<DayDetails {...props({ onClose })} />)
      fireEvent.keyDown(screen.getAllByRole('link')[0], { key: 'Enter' })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('is a region named by the date', () => {
    render(<DayDetails {...props()} />)
    expect(
      screen.getByRole('region', { name: 'Thursday, 24 September 2026' })
    ).toBeInTheDocument()
  })
})
