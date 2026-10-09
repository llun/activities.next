/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnchorHTMLAttributes, ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DateKey, parseDateKey } from '@/lib/fitness/calendar/localDay'
import { FitnessDayActivity } from '@/lib/fitness/calendar/types'

import { DayDetailsContentProps } from './DayDetails'
import { DayDetailsSheet, DayDetailsSheetProps } from './DayDetailsSheet'

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

const DATE = parseDateKey('2026-10-01') as DateKey

const activity = (
  overrides: Partial<FitnessDayActivity> = {}
): FitnessDayActivity => ({
  id: 'a1',
  activityType: 'road_cycling',
  startTime: Date.parse('2026-10-01T07:05:00Z'),
  totalDistanceMeters: 9600,
  totalDurationSeconds: 1980,
  elevationGainMeters: null,
  title: 'Morning ride',
  statusPath: '/@anna@llun.social/status-1',
  ...overrides
})

const props = (
  overrides: Partial<DayDetailsSheetProps> = {}
): DayDetailsSheetProps => ({
  date: DATE,
  timeZone: 'UTC',
  totals: {
    count: 3,
    totalDistanceMeters: 16800,
    totalDurationSeconds: 4440
  },
  activities: [
    activity(),
    activity({ id: 'a2', title: 'Evening run', activityType: 'running' }),
    activity({ id: 'a3', title: 'Cool-down spin', statusPath: null })
  ],
  loading: false,
  error: false,
  hasMore: false,
  onRetry: vi.fn(),
  onLoadMore: vi.fn(),
  onClose: vi.fn(),
  ...overrides
})

const sheet = () => screen.getByTestId('day-details-sheet')
const rows = () => screen.queryAllByTestId('day-activity-row')

describe('DayDetailsSheet', () => {
  it('is a nonmodal region: no scrim, no dialog semantics, no focus trap', () => {
    render(
      <div>
        <button type="button">Cell</button>
        <DayDetailsSheet {...props()} />
      </div>
    )
    expect(
      screen.getByRole('region', { name: 'Thursday, 1 October 2026' })
    ).toBe(sheet())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sheet()).not.toHaveAttribute('aria-modal')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
    expect(document.querySelector('[data-aria-hidden]')).toBeNull()

    // Selecting a day does not take focus, and the page behind stays usable.
    const cell = screen.getByRole('button', { name: 'Cell' })
    cell.focus()
    expect(cell).toHaveFocus()
    fireEvent.click(cell)
    expect(cell).toHaveFocus()
  })

  it('renders into the document body', () => {
    render(
      <div data-testid="host">
        <DayDetailsSheet {...props()} />
      </div>
    )
    expect(screen.getByTestId('host')).not.toContainElement(sheet())
    expect(sheet().parentElement).toBe(document.body)
  })

  it('collapses to the first activity with a "+N more" cue', () => {
    render(<DayDetailsSheet {...props()} />)
    expect(sheet()).toHaveAttribute('data-expanded', 'false')
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]).getByText('Morning ride')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '+2 more activities · Expand' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^3 activities · 16\.8.km · 1h.14m$/)
    ).toBeInTheDocument()
  })

  it('says "+1 more activity" in the singular', () => {
    render(
      <DayDetailsSheet
        {...props({
          totals: {
            count: 2,
            totalDistanceMeters: 1,
            totalDurationSeconds: 1
          },
          activities: [activity(), activity({ id: 'a2' })]
        })}
      />
    )
    expect(
      screen.getByRole('button', { name: '+1 more activity · Expand' })
    ).toBeInTheDocument()
  })

  it('shows no cue when everything is already visible', () => {
    render(
      <DayDetailsSheet
        {...props({
          totals: {
            count: 1,
            totalDistanceMeters: 1,
            totalDurationSeconds: 1
          },
          activities: [activity()]
        })}
      />
    )
    expect(screen.queryByText(/more activit/)).not.toBeInTheDocument()
  })

  it('counts rows still to load in the cue', () => {
    render(
      <DayDetailsSheet
        {...props({ activities: [activity()], hasMore: true })}
      />
    )
    expect(
      screen.getByRole('button', { name: '+2 more activities · Expand' })
    ).toBeInTheDocument()
  })

  it('expands and collapses again from the header or the cue', () => {
    render(<DayDetailsSheet {...props()} />)
    const toggle = screen.getByRole('button', { name: 'Expand day details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveClass('size-11')

    fireEvent.click(toggle)
    expect(sheet()).toHaveAttribute('data-expanded', 'true')
    expect(rows()).toHaveLength(3)
    expect(
      screen.queryByRole('button', { name: /more activit/ })
    ).not.toBeInTheDocument()
    const collapse = screen.getByRole('button', {
      name: 'Collapse day details'
    })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse.getAttribute('aria-controls')).toBe(
      rows()[0].closest('[id]')?.id
    )

    fireEvent.click(collapse)
    expect(sheet()).toHaveAttribute('data-expanded', 'false')
    expect(rows()).toHaveLength(1)

    // The cue expands too.
    fireEvent.click(
      screen.getByRole('button', { name: '+2 more activities · Expand' })
    )
    expect(rows()).toHaveLength(3)
  })

  it('collapses again when another day is selected', () => {
    const { rerender } = render(<DayDetailsSheet {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand day details' }))
    expect(rows()).toHaveLength(3)
    rerender(
      <DayDetailsSheet
        {...props({ date: parseDateKey('2026-10-02') as DateKey })}
      />
    )
    expect(sheet()).toHaveAttribute('data-expanded', 'false')
    expect(rows()).toHaveLength(1)
  })

  it('limits its height, collapsed and expanded', () => {
    const { rerender } = render(
      <DayDetailsSheet
        {...props({ collapsedMaxHeight: 240, expandedMaxHeight: '70dvh' })}
      />
    )
    expect(sheet().style.maxHeight).toBe('240px')
    fireEvent.click(screen.getByRole('button', { name: 'Expand day details' }))
    expect(sheet().style.maxHeight).toBe('70dvh')
    rerender(<DayDetailsSheet {...props()} />)
    expect(sheet().style.maxHeight).toBe('min(80dvh, 640px)')
  })

  it('calls onClose from Close and closes on Escape', () => {
    const onClose = vi.fn()
    render(<DayDetailsSheet {...props({ onClose })} />)
    const close = screen.getByRole('button', { name: 'Close day details' })
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getAllByRole('link')[0], { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('links rows without prefetching and leaves a missing post unlinked', () => {
    render(<DayDetailsSheet {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand day details' }))
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute('data-prefetch', 'false')
    }
    const missing = rows()[2]
    expect(within(missing).queryByRole('link')).not.toBeInTheDocument()
    expect(
      within(missing).getByText(/Linked post unavailable/)
    ).toBeInTheDocument()
  })

  it('shows Load more only when expanded', () => {
    const onLoadMore = vi.fn()
    render(<DayDetailsSheet {...props({ hasMore: true, onLoadMore })} />)
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand day details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('keeps the date and offers Retry on failure', () => {
    const onRetry = vi.fn()
    render(
      <DayDetailsSheet {...props({ activities: [], error: true, onRetry })} />
    )
    expect(
      screen.getByRole('heading', { name: 'Thursday, 1 October 2026' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows loading and empty states', () => {
    const { rerender } = render(
      <DayDetailsSheet {...props({ activities: [], loading: true })} />
    )
    expect(screen.getByTestId('day-details-loading')).toBeInTheDocument()
    rerender(<DayDetailsSheet {...props({ activities: [], totals: null })} />)
    expect(screen.getByText('No recorded activities')).toBeInTheDocument()
    expect(screen.queryByText(/more activit/)).not.toBeInTheDocument()
  })

  it('reports its rendered height for scroll padding', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let notify: () => void = () => {}
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(function (callback: () => void) {
        notify = callback
        return { observe, disconnect, unobserve: vi.fn() }
      })
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 210
    } as DOMRect)
    const onHeightChange = vi.fn()
    try {
      const { unmount } = render(
        <DayDetailsSheet {...props({ onHeightChange })} />
      )
      expect(onHeightChange).toHaveBeenCalledWith(210)
      notify()
      expect(onHeightChange).toHaveBeenCalledTimes(2)
      unmount()
      expect(disconnect).toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(globalThis, 'ResizeObserver')
      vi.restoreAllMocks()
    }
  })

  it('works inside a parent that restores focus on close', () => {
    function Parent() {
      const [open, setOpen] = useState(true)
      return (
        <div>
          <button type="button" data-testid="cell">
            1
          </button>
          {open && (
            <DayDetailsSheet
              {...(props() as DayDetailsContentProps)}
              onClose={() => {
                setOpen(false)
                screen.getByTestId('cell').focus()
              }}
            />
          )}
        </div>
      )
    }
    render(<Parent />)
    fireEvent.click(screen.getByRole('button', { name: 'Close day details' }))
    expect(screen.queryByTestId('day-details-sheet')).not.toBeInTheDocument()
    expect(screen.getByTestId('cell')).toHaveFocus()
  })
})
