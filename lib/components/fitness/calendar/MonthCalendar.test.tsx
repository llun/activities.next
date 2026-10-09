/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'

import { MonthCalendar, MonthCalendarHandle } from './MonthCalendar'
import { TODAY, key, stubElementWidth } from './calendarTestDoubles'

const day = (
  date: string,
  count: number,
  km = 10,
  minutes = 30
): FitnessCalendarDay => ({
  date,
  count,
  totalDistanceMeters: km * 1000,
  totalDurationSeconds: minutes * 60,
  totalElevationGainMeters: 0
})

const DAYS = [
  day('2026-10-02', 4, 120, 200),
  day('2026-10-01', 1, 5, 20),
  day('2026-09-24', 2, 42.6, 74)
]

type Props = Partial<Parameters<typeof MonthCalendar>[0]>

const renderMonth = (props: Props = {}) => {
  const onSelectDate = vi.fn()
  const view = render(
    <MonthCalendar
      year={2026}
      month={10}
      today={TODAY}
      days={DAYS}
      metric="count"
      selectedDate={null}
      onSelectDate={onSelectDate}
      crossfade={false}
      {...props}
    />
  )
  const cell = (date: string) =>
    view.container.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!
  const cells = () =>
    Array.from(view.container.querySelectorAll<HTMLElement>('[data-date]'))
  return { ...view, onSelectDate, cell, cells }
}

describe('MonthCalendar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('grid', () => {
    it('shows weekday labels over seven numbered columns', () => {
      const { container, cells } = renderMonth()

      expect(container.textContent).toContain('MonTueWedThuFriSatSun')
      expect(cells()).toHaveLength(31)
      expect(cells()[0]).toHaveTextContent('1')
      expect(cells()[30]).toHaveTextContent('31')
    })

    it('places the 1st on its weekday and renders nothing before it', () => {
      const { cell, cells } = renderMonth()

      // 1 Oct 2026 is a Thursday: column 4, below the header row.
      expect(cell('2026-10-01').style.gridColumn).toBe('4')
      expect(cell('2026-10-01').style.gridRow).toBe('2')
      expect(cell('2026-10-05').style.gridColumn).toBe('1')
      expect(cell('2026-10-05').style.gridRow).toBe('3')
      expect(cells().filter((c) => c.style.gridColumn === '1')).toHaveLength(4)
    })

    it('has seven columns of the measured square size', () => {
      const stub = stubElementWidth(908)
      try {
        const { container } = renderMonth()

        const root = container.querySelector<HTMLElement>(
          '[data-slot="month-calendar"]'
        )!
        const grid = container.querySelector<HTMLElement>('[role="group"]')!
        expect(root.style.getPropertyValue('--cell')).toBe('92px')
        expect(grid.style.gridTemplateColumns).toBe('repeat(7, var(--cell))')
      } finally {
        stub.restore()
      }
    })

    it.each([
      [908, '92px'],
      [730, '92px'],
      [358, `${(358 - 24) / 7}px`],
      [288, `${(288 - 24) / 7}px`]
    ])('is %ipx wide -> cells of %s', (width, size) => {
      const stub = stubElementWidth(width)
      try {
        const { container } = renderMonth()

        expect(
          container
            .querySelector<HTMLElement>('[data-slot="month-calendar"]')!
            .style.getPropertyValue('--cell')
        ).toBe(size)
      } finally {
        stub.restore()
      }
    })

    it('uses container units until a width is measured', () => {
      const { container } = renderMonth()

      expect(
        container
          .querySelector<HTMLElement>('[data-slot="month-calendar"]')!
          .style.getPropertyValue('--cell')
      ).toBe('min(92px, calc((100cqw - 24px) / 7))')
    })

    it('names the group by month and year', () => {
      renderMonth()

      expect(
        screen.getByRole('group', { name: 'October 2026' })
      ).toBeInTheDocument()
    })
  })

  describe('days', () => {
    it('disables upcoming days after today and outlines them', () => {
      const { cell } = renderMonth()

      expect(cell('2026-10-05')).toBeDisabled()
      expect(cell('2026-10-05')).toHaveAttribute('data-state', 'upcoming')
      expect(cell('2026-10-05')).toHaveAccessibleName(
        'Monday, 5 October 2026: Upcoming'
      )
      expect(cell('2026-10-31')).toBeDisabled()
      expect(cell('2026-10-04')).toBeEnabled()
    })

    it('does not select an upcoming day', () => {
      const { cell, onSelectDate } = renderMonth()

      fireEvent.click(cell('2026-10-05'))

      expect(onSelectDate).not.toHaveBeenCalled()
    })

    it('has no upcoming days in a month that has ended', () => {
      const { cells } = renderMonth({ month: 9 })

      expect(cells()).toHaveLength(30)
      expect(cells().every((c) => c.dataset.state === 'active')).toBe(true)
    })

    it('marks today with aria-current', () => {
      const { cell } = renderMonth()

      expect(cell('2026-10-04')).toHaveAttribute('aria-current', 'date')
      expect(cell('2026-10-03')).not.toHaveAttribute('aria-current')
    })

    it('names each day with its full date and values', () => {
      const { cell } = renderMonth()

      expect(cell('2026-10-02')).toHaveAccessibleName(
        'Friday, 2 October 2026: 4 activities, 120\u00a0km, 3h\u00a020m'
      )
      expect(cell('2026-10-03')).toHaveAccessibleName(
        'Saturday, 3 October 2026: No activities'
      )
    })

    it('levels follow the metric; the Heat 4 numeral colour comes from the token', () => {
      const { cell, rerender } = renderMonth()
      expect(cell('2026-10-02')).toHaveAttribute('data-level', '4')
      expect(cell('2026-10-01')).toHaveAttribute('data-level', '1')

      rerender(
        <MonthCalendar
          year={2026}
          month={10}
          today={TODAY}
          days={DAYS}
          metric="duration"
          selectedDate={null}
          onSelectDate={() => {}}
          crossfade={false}
        />
      )
      // 200 minutes is 2h+; 20 minutes is under 30m.
      expect(cell('2026-10-02')).toHaveAttribute('data-level', '4')
      expect(cell('2026-10-01')).toHaveAttribute('data-level', '1')
    })

    it('marks the selected day with aria-pressed', () => {
      const { cell, cells } = renderMonth({ selectedDate: key('2026-10-02') })

      expect(cell('2026-10-02')).toHaveAttribute('aria-pressed', 'true')
      expect(
        cells().filter((c) => c.getAttribute('aria-pressed') === 'true')
      ).toHaveLength(1)
      expect(cell('2026-10-02')).toHaveAttribute('data-level', '4')
    })

    it('slashes and disables days outside the applied range', () => {
      const { cell, onSelectDate } = renderMonth({
        month: 9,
        range: { from: key('2026-09-15'), to: TODAY }
      })

      expect(cell('2026-09-14')).toBeDisabled()
      expect(cell('2026-09-14')).toHaveAttribute('data-state', 'out')
      expect(cell('2026-09-15')).toBeEnabled()
      fireEvent.click(cell('2026-09-14'))
      expect(onSelectDate).not.toHaveBeenCalled()
    })

    it('keeps the first and last day of the range selectable', () => {
      const current = renderMonth({
        range: { from: key('2026-10-01'), to: TODAY }
      })
      expect(current.cell('2026-10-04')).toBeEnabled()
      current.unmount()
      const past = renderMonth({
        month: 9,
        range: { from: key('2026-09-01'), to: key('2026-09-30') }
      })
      expect(past.cell('2026-09-30')).toBeEnabled()
      expect(past.cell('2026-09-01')).toBeEnabled()
    })

    it('selects on click', () => {
      const { cell, onSelectDate } = renderMonth()

      fireEvent.click(cell('2026-10-02'))

      expect(onSelectDate).toHaveBeenCalledWith('2026-10-02')
    })
  })

  describe('keyboard', () => {
    it('has one tab stop: today in the current month', () => {
      const { cells } = renderMonth()

      expect(
        cells()
          .filter((c) => c.getAttribute('tabindex') === '0')
          .map((c) => c.dataset.date)
      ).toEqual(['2026-10-04'])
    })

    it('puts the tab stop on the last day of a past month with no selection', () => {
      const { cells } = renderMonth({ month: 9, selectedDate: null })

      expect(
        cells()
          .filter((c) => c.getAttribute('tabindex') === '0')
          .map((c) => c.dataset.date)
      ).toEqual(['2026-09-30'])
    })

    it('moves a day with Left/Right and a week with Up/Down', () => {
      const { cell } = renderMonth({ selectedDate: key('2026-10-02') })
      cell('2026-10-02').focus()

      fireEvent.keyDown(cell('2026-10-02'), { key: 'ArrowLeft' })
      expect(cell('2026-10-01')).toHaveFocus()

      fireEvent.keyDown(cell('2026-10-01'), { key: 'ArrowRight' })
      fireEvent.keyDown(cell('2026-10-02'), { key: 'ArrowRight' })
      expect(cell('2026-10-03')).toHaveFocus()

      // A week up from 3 Oct is 26 Sep, another month: clamped to the 1st.
      fireEvent.keyDown(cell('2026-10-03'), { key: 'ArrowUp' })
      expect(cell('2026-10-01')).toHaveFocus()
    })

    it('skips upcoming days: Right at today stays, End stops at today', () => {
      const { cell } = renderMonth()
      cell('2026-10-04').focus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowRight' })
      fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowDown' })
      fireEvent.keyDown(cell('2026-10-04'), { key: 'End' })

      expect(cell('2026-10-04')).toHaveFocus()
    })

    it('goes to the start of the week with Home, clamped to the month', () => {
      const { cell } = renderMonth()
      cell('2026-10-04').focus()

      // Sunday 4 Oct: its week starts Monday 28 Sep, so Home lands on 1 Oct.
      fireEvent.keyDown(cell('2026-10-04'), { key: 'Home' })

      expect(cell('2026-10-01')).toHaveFocus()
    })

    it('clamps PageUp and PageDown to the days that can be focused', () => {
      const { cell } = renderMonth()
      cell('2026-10-04').focus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'PageUp' })
      expect(cell('2026-10-01')).toHaveFocus()

      fireEvent.keyDown(cell('2026-10-01'), { key: 'PageDown' })
      expect(cell('2026-10-04')).toHaveFocus()
    })

    it('lets Escape bubble and restores focus on request', () => {
      const onEscape = vi.fn()
      const ref = createRef<MonthCalendarHandle>()
      render(
        <div onKeyDown={(event) => event.key === 'Escape' && onEscape()}>
          <MonthCalendar
            ref={ref}
            year={2026}
            month={10}
            today={TODAY}
            days={DAYS}
            metric="count"
            selectedDate={key('2026-10-02')}
            onSelectDate={() => {}}
            crossfade={false}
          />
        </div>
      )
      const cell = screen.getByRole('button', { name: /Friday, 2 October/ })
      cell.focus()

      fireEvent.keyDown(cell, { key: 'Escape' })
      expect(onEscape).toHaveBeenCalledTimes(1)

      screen.getByRole('button', { name: /Saturday, 3 October/ }).focus()
      act(() => ref.current?.focusDate(key('2026-10-02')))
      expect(cell).toHaveFocus()
    })
  })

  describe('month change crossfade', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const monthOf = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('[role="group"]')?.dataset.month

    const fadeLayer = (container: HTMLElement) =>
      container.querySelector<HTMLElement>(
        '[data-slot="month-calendar"] > div:nth-child(2)'
      )

    const september = (
      <MonthCalendar
        year={2026}
        month={9}
        today={TODAY}
        days={[]}
        metric="count"
        selectedDate={null}
        onSelectDate={() => {}}
      />
    )

    it('fades the old month out for 75ms, then swaps and fades in', () => {
      const { container, rerender } = render(
        <MonthCalendar
          year={2026}
          month={10}
          today={TODAY}
          days={DAYS}
          metric="count"
          selectedDate={null}
          onSelectDate={() => {}}
        />
      )
      expect(fadeLayer(container)).not.toHaveAttribute('data-fading')

      rerender(september)
      // Still the old month, now fading out (opacity only, no movement).
      expect(monthOf(container)).toBe('10')
      expect(fadeLayer(container)).toHaveAttribute('data-fading', 'true')

      act(() => vi.advanceTimersByTime(74))
      expect(monthOf(container)).toBe('10')

      act(() => vi.advanceTimersByTime(1))
      expect(monthOf(container)).toBe('9')
      expect(fadeLayer(container)).not.toHaveAttribute('data-fading')
    })

    it('keeps drawing the old month with its own data while it fades out', () => {
      const { container, rerender } = render(
        <MonthCalendar
          year={2026}
          month={10}
          today={TODAY}
          days={DAYS}
          metric="count"
          selectedDate={null}
          onSelectDate={() => {}}
        />
      )

      rerender(september)

      expect(
        container.querySelector('[data-date="2026-10-02"]')
      ).toHaveAttribute('data-level', '4')
    })

    it('swaps at once when the crossfade is off', () => {
      const { container, rerender } = render(
        <MonthCalendar
          year={2026}
          month={10}
          today={TODAY}
          days={DAYS}
          metric="count"
          selectedDate={null}
          onSelectDate={() => {}}
          crossfade={false}
        />
      )

      rerender(
        <MonthCalendar
          year={2026}
          month={9}
          today={TODAY}
          days={[]}
          metric="count"
          selectedDate={null}
          onSelectDate={() => {}}
          crossfade={false}
        />
      )

      expect(monthOf(container)).toBe('9')
    })
  })

  describe('tooltip', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const tooltip = () =>
      document.body.querySelector<HTMLElement>('[data-slot="calendar-tooltip"]')

    it('previews a day after the hover delay, but not the pinned one', () => {
      const { cell, rerender } = renderMonth()

      fireEvent.pointerOver(cell('2026-10-02'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(150))
      expect(tooltip()).toHaveTextContent('Friday, 2 October 2026')

      rerender(
        <MonthCalendar
          year={2026}
          month={10}
          today={TODAY}
          days={DAYS}
          metric="count"
          selectedDate={key('2026-10-02')}
          onSelectDate={() => {}}
          crossfade={false}
        />
      )
      expect(tooltip()?.dataset.visible).toBe('false')
    })

    const kbFocus = (el: HTMLElement) =>
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
        )
        el.focus()
      })

    it('shows on keyboard focus and hides on Escape', () => {
      const { cell } = renderMonth()
      kbFocus(cell('2026-10-02'))
      expect(tooltip()).toHaveTextContent('Friday, 2 October 2026')
      expect(tooltip()?.dataset.visible).toBe('true')
      fireEvent.keyDown(cell('2026-10-02'), { key: 'Escape' })
      expect(tooltip()?.dataset.visible).toBe('false')
    })

    it('hides when a day is clicked', () => {
      const { cell } = renderMonth()
      fireEvent.pointerOver(cell('2026-10-02'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(150))
      expect(tooltip()?.dataset.visible).toBe('true')
      fireEvent.click(cell('2026-10-02'))
      expect(tooltip()?.dataset.visible).toBe('false')
    })

    it('moves the tab stop with focus that arrives by Tab or click', () => {
      const { cell, cells } = renderMonth()
      act(() => cell('2026-10-02').focus())
      expect(
        cells()
          .filter((c) => c.getAttribute('tabindex') === '0')
          .map((c) => c.dataset.date)
      ).toEqual(['2026-10-02'])
    })

    it('is not shown for an upcoming day', () => {
      const { cell } = renderMonth()

      fireEvent.pointerOver(cell('2026-10-05'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(400))

      expect(tooltip()).toBeNull()
    })
  })

  it('keeps the layout while loading: dimmed, busy and the module skeleton sweep', () => {
    const { cells, container } = renderMonth({ loading: true })

    expect(cells()).toHaveLength(31)
    expect(cells().every((c) => c.dataset.loading === 'true')).toBe(true)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/animate-|shimmer/)
  })

  it('never names an active day a rest day before its data has landed', () => {
    const { cell, cells } = renderMonth({ loading: true, days: [] })

    expect(cell('2026-10-02')).toHaveAttribute(
      'aria-label',
      'Friday, 2 October 2026: Loading'
    )
    // Upcoming days keep their own wording.
    expect(cell('2026-10-05')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Monday, 5 October 2026: Upcoming/)
    )
    expect(
      cells().some((c) => /No activities/.test(c.getAttribute('aria-label')!))
    ).toBe(false)
  })

  describe('tooltip while loading', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('previews the date and "Loading", not "No activities"', () => {
      const { cell } = renderMonth({ loading: true, days: [] })

      fireEvent.pointerOver(cell('2026-10-02'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(150))

      const tip = document.body.querySelector<HTMLElement>(
        '[data-slot="calendar-tooltip"]'
      )
      expect(tip).toHaveTextContent('Friday, 2 October 2026')
      expect(tip).toHaveTextContent('Loading')
      expect(tip).not.toHaveTextContent('No activities')
    })
  })
})
