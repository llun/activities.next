/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'

import { annualYearGrid } from '@/lib/fitness/calendar/geometry'
import { DateKey } from '@/lib/fitness/calendar/localDay'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'

import { AnnualCalendar, AnnualCalendarHandle } from './AnnualCalendar'
import {
  TODAY,
  key,
  stubElementWidth,
  stubReducedMotion
} from './calendarTestDoubles'

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
  day('2026-09-24', 2, 42.6, 74),
  day('2026-10-02', 4, 120, 200),
  day('2026-09-30', 1, 5, 20)
]

const YTD = { from: key('2026-01-01'), to: TODAY }

type Props = Partial<Parameters<typeof AnnualCalendar>[0]>

const renderCalendar = (props: Props = {}) => {
  const onSelectDate = vi.fn()
  const onOpenMonth = vi.fn()
  const view = render(
    <AnnualCalendar
      range={YTD}
      today={TODAY}
      days={DAYS}
      metric="count"
      selectedDate={null}
      onSelectDate={onSelectDate}
      onOpenMonth={onOpenMonth}
      {...props}
    />
  )
  const cell = (date: string) =>
    view.container.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!
  const cells = () =>
    Array.from(view.container.querySelectorAll<HTMLElement>('[data-date]'))
  return { ...view, onSelectDate, onOpenMonth, cell, cells }
}

describe('AnnualCalendar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('grid', () => {
    it('is 40 week columns for 2026 year to date, ending on Sunday 4 Oct', () => {
      const { container, cell } = renderCalendar()

      const grid = container.querySelector<HTMLElement>(
        '[style*="grid-template-columns"]'
      )
      expect(grid?.style.gridTemplateColumns).toBe('repeat(40, var(--cell))')
      expect(cell('2026-10-04')?.style.gridColumn).toBe('40')
      expect(cell('2026-10-04')?.style.gridRow).toBe('8')
    })

    it('renders one cell per real day and nothing for padding', () => {
      const { cells, cell } = renderCalendar()

      // 1 Jan to 4 Oct 2026.
      expect(cells()).toHaveLength(277)
      // 1 Jan 2026 is a Thursday: Monday to Wednesday of column 1 do not exist.
      const firstColumn = cells().filter((c) => c.style.gridColumn === '1')
      expect(firstColumn.map((c) => c.dataset.date)).toEqual([
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
        '2026-01-04'
      ])
      expect(cell('2026-01-01')?.style.gridRow).toBe('5')
    })

    it('stops at today: no upcoming cells in the annual grid', () => {
      const { cell } = renderCalendar()

      expect(cell('2026-10-05')).toBeNull()
      expect(cell('2026-12-31')).toBeNull()
    })

    it('draws one labelled row per year, oldest first, for a multi-year range', () => {
      renderCalendar({
        range: { from: key('2025-10-05'), to: TODAY }
      })

      const groups = screen
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label'))
        .filter((name) => name?.startsWith('Training calendar'))
      expect(groups).toEqual([
        'Training calendar, 2025',
        'Training calendar, 2026'
      ])
    })

    it('shows a past year from 1 Jan to 31 Dec', () => {
      const { cell, cells } = renderCalendar({
        range: { from: key('2024-01-01'), to: key('2024-12-31') }
      })

      expect(cells()).toHaveLength(366)
      expect(cell('2024-02-29')).not.toBeNull()
      expect(cell('2024-12-31')).not.toBeNull()
    })

    it('uses the same square size in every row of a multi-year range', () => {
      const stub = stubElementWidth(908)
      try {
        const { container } = renderCalendar({
          range: { from: key('2025-10-05'), to: TODAY }
        })

        // The 53-column row decides it: (905 - 28 - 159) / 53 = 13.5.
        const root = container.querySelector<HTMLElement>(
          '[data-slot="annual-calendar"]'
        )
        expect(parseFloat(root!.style.getPropertyValue('--cell'))).toBeCloseTo(
          13.547,
          2
        )
      } finally {
        stub.restore()
      }
    })
  })

  describe('cell size', () => {
    const cellSizeAt = (width: number, props: Props = {}) => {
      const stub = stubElementWidth(width)
      try {
        const { container } = renderCalendar(props)
        return container
          .querySelector<HTMLElement>('[data-slot="annual-calendar"]')!
          .style.getPropertyValue('--cell')
      } finally {
        stub.restore()
      }
    }

    it.each([
      // Wide container: the full 18px.
      [908, 18],
      // Never below 12px: the grid scrolls inside instead.
      [358, 12],
      // Shrinks between the two as the container narrows:
      // (700 - 3 - 28 - 120) / 40 = 13.725
      [700, 13.725]
    ])('is sized from a %ipx container', (width, expected) => {
      expect(cellSizeAt(width)).toMatch(/px$/)
      expect(parseFloat(cellSizeAt(width))).toBeCloseTo(expected, 2)
    })

    it('uses container units until a width is measured, so the first paint agrees', () => {
      const { container } = renderCalendar()

      expect(
        container
          .querySelector<HTMLElement>('[data-slot="annual-calendar"]')!
          .style.getPropertyValue('--cell')
      ).toBe('clamp(12px, calc((100cqw - 31px - 120px) / 40), 18px)')
    })

    it('follows the container when it is resized', () => {
      const stub = stubElementWidth(908)
      try {
        const { container } = renderCalendar()
        const root = container.querySelector<HTMLElement>(
          '[data-slot="annual-calendar"]'
        )!
        expect(root.style.getPropertyValue('--cell')).toBe('18px')

        stub.resize(358)

        expect(root.style.getPropertyValue('--cell')).toBe('12px')
      } finally {
        stub.restore()
      }
    })
  })

  describe('cell states', () => {
    it('names every cell with its full date and values', () => {
      const { cell } = renderCalendar()

      expect(cell('2026-09-24')).toHaveAccessibleName(
        'Thursday, 24 September 2026: 2 activities, 42.6\u00a0km, 1h\u00a014m'
      )
      expect(cell('2026-09-25')).toHaveAccessibleName(
        'Friday, 25 September 2026: No activities'
      )
    })

    it('has no native title tooltip', () => {
      const { cells } = renderCalendar()

      expect(cells().every((c) => !c.hasAttribute('title'))).toBe(true)
    })

    it('shades by the chosen metric with fixed levels', () => {
      const { cell, rerender } = renderCalendar()
      // 4 activities / 120 km / 200 min on 2 Oct; 1 activity / 5 km on 30 Sep.
      expect(cell('2026-10-02')).toHaveAttribute('data-level', '4')
      expect(cell('2026-09-30')).toHaveAttribute('data-level', '1')
      expect(cell('2026-09-29')).toHaveAttribute('data-level', '0')

      rerender(
        <AnnualCalendar
          range={YTD}
          today={TODAY}
          days={DAYS}
          metric="distance"
          selectedDate={null}
          onSelectDate={() => {}}
          onOpenMonth={() => {}}
        />
      )
      // 42.6 km is level 3; 5 km is level 1.
      expect(cell('2026-09-24')).toHaveAttribute('data-level', '3')
      expect(cell('2026-09-30')).toHaveAttribute('data-level', '1')
    })

    it('marks today with aria-current and a non-colour dot', () => {
      const { cell } = renderCalendar()

      expect(cell('2026-10-04')).toHaveAttribute('aria-current', 'date')
      expect(cell('2026-10-04').querySelector('span')).not.toBeNull()
      expect(cell('2026-10-03')).not.toHaveAttribute('aria-current')
    })

    it('marks the selected day with aria-pressed and leaves the rest unpressed', () => {
      const { cell, cells } = renderCalendar({
        selectedDate: key('2026-09-24')
      })

      expect(cell('2026-09-24')).toHaveAttribute('aria-pressed', 'true')
      const pressed = cells().filter(
        (c) => c.getAttribute('aria-pressed') === 'true'
      )
      expect(pressed).toHaveLength(1)
      expect(cell('2026-09-25')).toHaveAttribute('aria-pressed', 'false')
    })

    it('keeps a selected cell green: selection is a ring, not a different fill', () => {
      const { cell } = renderCalendar({ selectedDate: key('2026-10-02') })

      expect(cell('2026-10-02')).toHaveAttribute('data-level', '4')
    })

    it('disables days outside the applied range and slashes them', () => {
      const { cell } = renderCalendar({
        range: { from: key('2026-03-01'), to: TODAY }
      })

      expect(cell('2026-02-28')).toBeDisabled()
      expect(cell('2026-02-28')).toHaveAttribute('data-state', 'out')
      expect(cell('2026-02-28')).toHaveAccessibleName(
        'Saturday, 28 February 2026: Outside the selected range'
      )
      expect(cell('2026-02-28')).not.toHaveAttribute('data-level')
      expect(cell('2026-03-01')).toBeEnabled()
      // Out of range is not a rest day: a rest day is an enabled neutral fill.
      expect(cell('2026-03-02')).toHaveAttribute('data-level', '0')
      expect(cell('2026-03-02')).toBeEnabled()
    })

    it('does not select a disabled day', () => {
      const { cell, onSelectDate } = renderCalendar({
        range: { from: key('2026-03-01'), to: TODAY }
      })

      fireEvent.click(cell('2026-02-28'))

      expect(onSelectDate).not.toHaveBeenCalled()
    })
  })

  describe('selection', () => {
    it('selects a day on click', () => {
      const { cell, onSelectDate } = renderCalendar()

      fireEvent.click(cell('2026-09-24'))

      expect(onSelectDate).toHaveBeenCalledWith('2026-09-24')
    })

    it('uses real buttons, so Enter and Space select natively', () => {
      const { cell } = renderCalendar()

      expect(cell('2026-09-24').tagName).toBe('BUTTON')
      expect(cell('2026-09-24')).toHaveAttribute('type', 'button')
    })
  })

  describe('keyboard', () => {
    const tabStops = (cells: () => HTMLElement[]) =>
      cells().filter((c) => c.getAttribute('tabindex') === '0')

    it('has one tab stop for the whole calendar: today', () => {
      const { cells } = renderCalendar()

      expect(tabStops(cells).map((c) => c.dataset.date)).toEqual(['2026-10-04'])
    })

    it('puts the tab stop on the selected day when there is one', () => {
      const { cells } = renderCalendar({ selectedDate: key('2026-03-10') })

      expect(tabStops(cells).map((c) => c.dataset.date)).toEqual(['2026-03-10'])
    })

    it('keeps one tab stop across years', () => {
      const { cells } = renderCalendar({
        range: { from: key('2025-10-05'), to: TODAY }
      })

      expect(tabStops(cells)).toHaveLength(1)
    })

    it('moves a week with Left/Right and a day with Up/Down', () => {
      const { cell } = renderCalendar({ selectedDate: key('2026-06-15') })
      cell('2026-06-15').focus()

      fireEvent.keyDown(cell('2026-06-15'), { key: 'ArrowLeft' })
      expect(cell('2026-06-08')).toHaveFocus()

      fireEvent.keyDown(cell('2026-06-08'), { key: 'ArrowDown' })
      expect(cell('2026-06-09')).toHaveFocus()

      fireEvent.keyDown(cell('2026-06-09'), { key: 'ArrowRight' })
      expect(cell('2026-06-16')).toHaveFocus()

      fireEvent.keyDown(cell('2026-06-16'), { key: 'ArrowUp' })
      expect(cell('2026-06-15')).toHaveFocus()
    })

    it('goes to the first and last day with Home and End, a month with PageUp/PageDown', () => {
      const { cell } = renderCalendar({ selectedDate: key('2026-06-15') })
      cell('2026-06-15').focus()

      fireEvent.keyDown(cell('2026-06-15'), { key: 'PageUp' })
      expect(cell('2026-05-15')).toHaveFocus()

      fireEvent.keyDown(cell('2026-05-15'), { key: 'PageDown' })
      fireEvent.keyDown(cell('2026-06-15'), { key: 'PageDown' })
      expect(cell('2026-07-15')).toHaveFocus()

      fireEvent.keyDown(cell('2026-07-15'), { key: 'End' })
      expect(cell('2026-10-04')).toHaveFocus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'Home' })
      expect(cell('2026-01-01')).toHaveFocus()
    })

    it('clamps at both ends of the range', () => {
      const { cell } = renderCalendar()
      cell('2026-10-04').focus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowRight' })
      fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowDown' })
      expect(cell('2026-10-04')).toHaveFocus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'Home' })
      fireEvent.keyDown(cell('2026-01-01'), { key: 'ArrowLeft' })
      fireEvent.keyDown(cell('2026-01-01'), { key: 'ArrowUp' })
      expect(cell('2026-01-01')).toHaveFocus()
    })

    it('never lands on a day outside the range', () => {
      const { cell } = renderCalendar({
        range: { from: key('2026-03-01'), to: TODAY },
        selectedDate: key('2026-03-03')
      })
      cell('2026-03-03').focus()

      fireEvent.keyDown(cell('2026-03-03'), { key: 'Home' })

      expect(cell('2026-03-01')).toHaveFocus()
      fireEvent.keyDown(cell('2026-03-01'), { key: 'ArrowUp' })
      expect(cell('2026-03-01')).toHaveFocus()
    })

    it('lets Escape bubble so the parent can close its details', () => {
      const onEscape = vi.fn()
      const ref = createRef<AnnualCalendarHandle>()
      render(
        <div onKeyDown={(event) => event.key === 'Escape' && onEscape()}>
          <AnnualCalendar
            ref={ref}
            range={YTD}
            today={TODAY}
            days={DAYS}
            metric="count"
            selectedDate={key('2026-09-24')}
            onSelectDate={() => {}}
            onOpenMonth={() => {}}
          />
        </div>
      )
      const cell = screen.getByRole('button', {
        name: /Thursday, 24 September 2026/
      })
      cell.focus()

      fireEvent.keyDown(cell, { key: 'Escape' })
      expect(onEscape).toHaveBeenCalledTimes(1)
    })

    it('restores focus to a day on request (Escape or Close in the parent)', () => {
      const ref = createRef<AnnualCalendarHandle>()
      render(
        <AnnualCalendar
          ref={ref}
          range={YTD}
          today={TODAY}
          days={DAYS}
          metric="count"
          selectedDate={key('2026-09-24')}
          onSelectDate={() => {}}
          onOpenMonth={() => {}}
        />
      )

      act(() => ref.current?.focusDate(key('2026-09-24')))

      expect(
        screen.getByRole('button', { name: /Thursday, 24 September 2026/ })
      ).toHaveFocus()
    })

    it('describes the keys to assistive technology', () => {
      const { cell } = renderCalendar()
      const group = cell('2026-10-04').closest('[role="group"]')!

      const help = document.getElementById(
        group.getAttribute('aria-describedby')!
      )
      expect(help).toHaveTextContent(/arrow keys/i)
    })
  })

  describe('month labels', () => {
    it('are buttons with descriptive names that open that month', () => {
      const { onOpenMonth } = renderCalendar()

      const september = screen.getByRole('button', {
        name: 'Show September 2026'
      })
      expect(september).toHaveTextContent('Sep')
      fireEvent.click(september)

      expect(onOpenMonth).toHaveBeenCalledWith(2026, 9)
    })

    it('exist for every month up to the one that contains today', () => {
      renderCalendar()

      const names = screen
        .getAllByRole('button', { name: /^Show / })
        .map((button) => button.getAttribute('aria-label'))
      expect(names).toHaveLength(10)
      expect(names[0]).toBe('Show January 2026')
      expect(names[9]).toBe('Show October 2026')
    })

    it('are plain text for a month the range does not reach', () => {
      renderCalendar({ range: { from: key('2026-03-15'), to: TODAY } })

      expect(
        screen.queryByRole('button', { name: 'Show January 2026' })
      ).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Show March 2026' })
      ).toBeInTheDocument()
    })

    it('sit on the column of the 1st', () => {
      const { container } = renderCalendar()
      const grid = annualYearGrid({
        year: 2026,
        range: YTD,
        today: TODAY
      })

      const labels = container.querySelectorAll<HTMLElement>(
        '[data-slot="month-label"]'
      )
      expect(
        [...labels].map((label) => label.style.gridColumn.split(' ')[0])
      ).toEqual(grid.monthLabels.map((label) => String(label.col + 1)))
    })

    it('lays each month label over four week columns, so its target is wider than 44px', () => {
      const { container } = renderCalendar()

      const january = container.querySelector<HTMLElement>(
        '[data-slot="month-label"][data-month="1"]'
      )
      const september = container.querySelector<HTMLElement>(
        '[data-slot="month-label"][data-month="9"]'
      )
      // Four columns is 4 x 12 + 3 x 3 = 57px at the smallest cell; the label
      // never reaches the next month's own column (month starts are 4+ apart).
      expect(january?.style.gridColumn).toBe('1 / span 4')
      expect(september?.style.gridColumn).toBe('36 / span 4')
      expect(january?.style.justifySelf).toBe('')
    })

    it('says how to use the phone grid: tap a month label, scroll for earlier months', () => {
      const { container } = renderCalendar()

      const hint = container.querySelector('[data-slot="annual-hint"]')
      expect(hint).toHaveTextContent('Tap a month label to open it')
      expect(hint).toHaveTextContent('Scroll for earlier months')
    })

    it('right-aligns a label that would overrun the end of the grid', () => {
      const { container } = renderCalendar()

      const october = container.querySelector<HTMLElement>(
        '[data-slot="month-label"][data-month="10"]'
      )
      // Oct 1 is in column 40, the last, so it has one column of room.
      expect(october?.style.gridColumn).toBe('40 / span 1')
      expect(october?.style.justifySelf).toBe('end')
    })
  })

  describe('scrolling', () => {
    it('puts one snap anchor on each month-start column', () => {
      const { container } = renderCalendar()
      const grid = annualYearGrid({ year: 2026, range: YTD, today: TODAY })

      const anchors =
        container.querySelectorAll<HTMLElement>('[data-snap-anchor]')
      expect(anchors).toHaveLength(10)
      expect([...anchors].map((anchor) => anchor.style.gridColumn)).toEqual(
        grid.monthStartColumns.map((col) => String(col + 1))
      )
      for (const anchor of anchors) {
        expect(anchor).toHaveAttribute('aria-hidden', 'true')
      }
    })

    it('shows the year and the weekday labels', () => {
      const { container } = renderCalendar()

      const labels = container.querySelector<HTMLElement>(
        '[data-slot="annual-labels"]'
      )!
      expect(labels).toHaveTextContent('2026')
      expect(labels).toHaveTextContent('MonTueWedThuFriSatSun')
    })

    describe('with a real layout', () => {
      let scrollLeft = 0
      const metrics = { clientWidth: 300, scrollWidth: 1000 }

      beforeEach(() => {
        scrollLeft = 0
        vi.spyOn(
          HTMLElement.prototype,
          'scrollWidth',
          'get'
        ).mockImplementation(() => metrics.scrollWidth)
        vi.spyOn(
          HTMLElement.prototype,
          'clientWidth',
          'get'
        ).mockImplementation(() => metrics.clientWidth)
        vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(
          () => scrollLeft
        )
        vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'set').mockImplementation(
          (value: number) => {
            scrollLeft = value
          }
        )
      })

      const scrollerOf = (container: HTMLElement) =>
        container.querySelector<HTMLElement>('[data-slot="annual-scroller"]')!

      it('starts scrolled to the end, instantly, so today is visible', () => {
        const { container } = renderCalendar()

        expect(scrollerOf(container).scrollLeft).toBe(1000)
      })

      it('fades only the side that has hidden content', () => {
        const { container } = renderCalendar()
        const scroller = scrollerOf(container)

        // At the end: content hidden to the start, none past the end, so the
        // end fade is never drawn over today.
        expect(scroller).toHaveAttribute('data-fade-start', 'true')
        expect(scroller).toHaveAttribute('data-fade-end', 'false')

        scrollLeft = 0
        fireEvent.scroll(scroller)
        return vi.waitFor(() => {
          expect(scroller).toHaveAttribute('data-fade-start', 'false')
          expect(scroller).toHaveAttribute('data-fade-end', 'true')
        })
      })

      it('fades both sides in the middle', () => {
        const { container } = renderCalendar()
        const scroller = scrollerOf(container)

        scrollLeft = 350
        fireEvent.scroll(scroller)

        return vi.waitFor(() => {
          expect(scroller).toHaveAttribute('data-fade-start', 'true')
          expect(scroller).toHaveAttribute('data-fade-end', 'true')
        })
      })

      it('draws no fade when everything fits', () => {
        metrics.scrollWidth = 300
        try {
          const { container } = renderCalendar()

          expect(scrollerOf(container)).toHaveAttribute(
            'data-fade-start',
            'false'
          )
          expect(scrollerOf(container)).toHaveAttribute(
            'data-fade-end',
            'false'
          )
        } finally {
          metrics.scrollWidth = 1000
        }
      })

      it('keeps the person where they scrolled when the cell size settles', () => {
        const stub = stubElementWidth(908)
        try {
          const { container } = renderCalendar()
          const scroller = scrollerOf(container)
          fireEvent.wheel(scroller)
          scrollLeft = 120

          stub.resize(700)

          expect(scroller.scrollLeft).toBe(120)
        } finally {
          stub.restore()
        }
      })
    })

    describe('programmatic jumps', () => {
      const scrollIntoView = vi.fn()

      beforeEach(() => {
        scrollIntoView.mockReset()
        Element.prototype.scrollIntoView = scrollIntoView
      })

      afterEach(() => {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      })

      it('glides when moving focus with the keyboard', () => {
        stubReducedMotion(false)
        const { cell } = renderCalendar({ selectedDate: key('2026-06-15') })
        cell('2026-06-15').focus()

        fireEvent.keyDown(cell('2026-06-15'), { key: 'ArrowLeft' })

        expect(scrollIntoView).toHaveBeenCalledWith(
          expect.objectContaining({ behavior: 'smooth', inline: 'nearest' })
        )
      })

      it('jumps instantly under prefers-reduced-motion', () => {
        stubReducedMotion(true)
        const { cell } = renderCalendar({ selectedDate: key('2026-06-15') })
        cell('2026-06-15').focus()

        fireEvent.keyDown(cell('2026-06-15'), { key: 'ArrowLeft' })

        expect(scrollIntoView).toHaveBeenCalledWith(
          expect.objectContaining({ behavior: 'auto' })
        )
      })
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

    it('shows the full date, count, distance and duration after the hover delay', () => {
      const { cell } = renderCalendar()

      fireEvent.pointerOver(cell('2026-09-24'), { pointerType: 'mouse' })
      expect(tooltip()).toBeNull()
      act(() => vi.advanceTimersByTime(150))

      expect(tooltip()).toHaveTextContent('Thursday, 24 September 2026')
      expect(tooltip()).toHaveTextContent('2 activities · 42.6 km · 1h 14m')
    })

    const layout = () =>
      vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const [left, width] = this.matches('[data-slot="annual-scroller"]')
            ? [0, 600]
            : [200, 18]
          return {
            left,
            right: left + width,
            top: 300,
            bottom: 318,
            width,
            height: 18,
            x: left,
            y: 300,
            toJSON: () => ({})
          } as DOMRect
        })

    it('shows on keyboard focus and hides on Escape', () => {
      layout()
      const { cell } = renderCalendar()

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
        )
        cell('2026-09-24').focus()
      })
      expect(tooltip()?.dataset.visible).toBe('true')

      fireEvent.keyDown(cell('2026-09-24'), { key: 'Escape' })
      expect(tooltip()?.dataset.visible).toBe('false')
    })

    it('hides a hover tooltip when the year row scrolls', () => {
      layout()
      const { cell, container } = renderCalendar()

      fireEvent.pointerOver(cell('2026-09-24'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(150))
      expect(tooltip()?.dataset.visible).toBe('true')

      fireEvent.scroll(
        container.querySelector('[data-slot="annual-scroller"]') as HTMLElement
      )
      expect(tooltip()?.dataset.visible).toBe('false')
    })

    it('is suppressed for the pinned day', () => {
      const { cell } = renderCalendar({ selectedDate: key('2026-09-24') })

      fireEvent.pointerOver(cell('2026-09-24'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(400))

      expect(tooltip()).toBeNull()
    })

    it('is hidden for touch', () => {
      const { cell } = renderCalendar()

      fireEvent.pointerOver(cell('2026-09-24'), { pointerType: 'touch' })
      act(() => vi.advanceTimersByTime(400))

      expect(tooltip()).toBeNull()
    })

    it('does not describe days outside the range', () => {
      const { cell } = renderCalendar({
        range: { from: key('2026-03-01'), to: TODAY }
      })

      fireEvent.pointerOver(cell('2026-02-28'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(400))

      expect(tooltip()).toBeNull()
    })

    it('goes away when a day is selected', () => {
      // Lay the scroller out at 600px and the cell inside it, clear of the
      // 28px sticky label column, so the tooltip has something to point at.
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect'
      ).mockImplementation(function (this: HTMLElement) {
        const [left, width] = this.matches('[data-slot="annual-scroller"]')
          ? [0, 600]
          : [200, 18]
        return {
          left,
          right: left + width,
          top: 300,
          bottom: 318,
          width,
          height: 18,
          x: left,
          y: 300,
          toJSON: () => ({})
        }
      })
      const { cell } = renderCalendar()
      fireEvent.pointerOver(cell('2026-09-24'), { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(150))
      expect(tooltip()?.dataset.visible).toBe('true')

      fireEvent.click(cell('2026-09-24'))

      expect(tooltip()?.dataset.visible).toBe('false')
    })
  })

  describe('loading', () => {
    it('keeps the layout: every cell stays, dimmed and busy, with no per-cell animation', () => {
      const { cells, container } = renderCalendar({ loading: true })

      expect(cells()).toHaveLength(277)
      expect(cells().every((c) => c.dataset.loading === 'true')).toBe(true)
      const dimmed = container.querySelector('[aria-busy="true"]')
      expect(dimmed).not.toBeNull()
      expect(dimmed?.getAttribute('data-loading')).toBe('true')
      // The sweep is the CSS module's one viewport-attached band
      // (calendar.module.css.test.ts), never a `.skeleton` or `animate-*`
      // class on each of 277 cells.
      expect(container.innerHTML).not.toMatch(/animate-|skeleton|shimmer/)
    })

    it('is idle by default', () => {
      const { container, cell } = renderCalendar()

      expect(container.querySelector('[aria-busy]')).toBeNull()
      expect(cell('2026-09-24')).not.toHaveAttribute('data-loading')
    })

    it('never names a day a rest day before its data has landed', () => {
      const { cell, cells } = renderCalendar({ loading: true, days: [] })

      expect(cell('2026-09-24')).toHaveAttribute(
        'aria-label',
        'Thursday, 24 September 2026: Loading'
      )
      expect(
        cells().some((c) => /No activities/.test(c.getAttribute('aria-label')!))
      ).toBe(false)
    })

    it('previews the date and "Loading", not "No activities", on hover', () => {
      vi.useFakeTimers()
      try {
        const { cell } = renderCalendar({ loading: true, days: [] })

        fireEvent.pointerOver(cell('2026-09-24'), { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(150))

        const tip = document.body.querySelector<HTMLElement>(
          '[data-slot="calendar-tooltip"]'
        )
        expect(tip).toHaveTextContent('Thursday, 24 September 2026')
        expect(tip).toHaveTextContent('Loading')
        expect(tip).not.toHaveTextContent('No activities')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('empty', () => {
    it('renders nothing for a range that has not started', () => {
      const { container } = renderCalendar({
        range: { from: key('2027-01-01'), to: key('2027-12-31') }
      })

      expect(container).toBeEmptyDOMElement()
    })

    it('keeps the whole structure for a range with no activity', () => {
      const { cells } = renderCalendar({ days: [] })

      expect(cells()).toHaveLength(277)
      expect(cells().every((c) => c.dataset.level === '0')).toBe(true)
    })
  })

  describe('caption and legend', () => {
    it('says what each row covers', () => {
      renderCalendar()

      expect(screen.getByText(/Activity through 4 Oct/)).toBeInTheDocument()
    })

    it('captions a past year with its exact dates', () => {
      renderCalendar({
        range: { from: key('2024-01-01'), to: key('2024-12-31') }
      })

      expect(screen.getByText(/1 Jan – 31 Dec 2024/)).toBeInTheDocument()
    })

    it('clips the first and last row of a multi-year range to the range', () => {
      renderCalendar({
        range: { from: key('2025-10-05'), to: TODAY }
      })

      expect(screen.getByText(/5 Oct – 31 Dec 2025/)).toBeInTheDocument()
      expect(screen.getByText(/Activity through 4 Oct/)).toBeInTheDocument()
      expect(screen.queryByText(/1 Jan – 31 Dec 2025/)).toBeNull()
    })

    it('captions each year of a past multi-year range with the days it covers', () => {
      renderCalendar({
        range: { from: key('2024-03-01'), to: key('2025-06-30') }
      })

      expect(screen.getByText(/1 Mar – 31 Dec 2024/)).toBeInTheDocument()
      expect(screen.getByText(/1 Jan – 30 Jun 2025/)).toBeInTheDocument()
    })

    it('does not say "through today" for a range of this year that ended earlier', () => {
      renderCalendar({
        range: { from: key('2026-03-01'), to: key('2026-06-30') }
      })

      expect(screen.getByText(/1 Mar – 30 Jun 2026/)).toBeInTheDocument()
      expect(screen.queryByText(/Activity through/)).toBeNull()
    })

    it('shows the legend beside the last row only', () => {
      renderCalendar({
        range: { from: key('2025-10-05'), to: TODAY },
        legend: <ul aria-label="Legend" />
      })

      const rows = screen
        .getAllByRole('group')
        .filter((group) =>
          group.getAttribute('aria-label')?.startsWith('Training calendar')
        )
      expect(within(rows[0]).queryByLabelText('Legend')).toBeNull()
      expect(within(rows[1]).getByLabelText('Legend')).toBeInTheDocument()
    })
  })

  it('sizes to its container, never the viewport', () => {
    const { container } = renderCalendar()

    expect(container.innerHTML).not.toMatch(/class="[^"]*\b(sm|md|lg|xl):/)
  })
})

describe('AnnualCalendar dates as keys', () => {
  it('treats the date keys as plain calendar days, whatever the process zone', () => {
    const { container } = render(
      <AnnualCalendar
        range={{ from: key('2026-03-28') as DateKey, to: key('2026-03-30') }}
        today={key('2026-03-30')}
        days={[]}
        metric="count"
        selectedDate={null}
        onSelectDate={() => {}}
        onOpenMonth={() => {}}
      />
    )

    // 29 March 2026 is the European spring-forward day: it still has one cell.
    expect(container.querySelectorAll('[data-date="2026-03-29"]')).toHaveLength(
      1
    )
  })
})
