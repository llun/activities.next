/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FC } from 'react'

import { DateKey, addDays } from '@/lib/fitness/calendar/localDay'

import { key, stubReducedMotion } from './calendarTestDoubles'
import {
  RovingLayout,
  nextRovingDate,
  useRovingDateFocus
} from './useRovingDateFocus'

/** Every day from `from` to `to`, inclusive. */
const span = (from: string, to: string): DateKey[] => {
  const days: DateKey[] = []
  for (let day = key(from); day <= key(to); day = addDays(day, 1)) {
    days.push(day)
  }
  return days
}

const move = (
  keyName: string,
  from: string,
  layout: RovingLayout,
  dates: DateKey[]
) =>
  nextRovingDate({
    key: keyName,
    from: key(from),
    layout,
    dates,
    enabled: new Set(dates)
  })

describe('nextRovingDate', () => {
  const year = span('2026-01-01', '2026-10-04')

  describe('annual layout: weeks are columns', () => {
    it.each([
      ['ArrowLeft', '2026-06-15', '2026-06-08'],
      ['ArrowRight', '2026-06-15', '2026-06-22'],
      ['ArrowUp', '2026-06-15', '2026-06-14'],
      ['ArrowDown', '2026-06-15', '2026-06-16'],
      ['PageUp', '2026-06-15', '2026-05-15'],
      ['PageDown', '2026-06-15', '2026-07-15'],
      ['PageDown', '2026-01-31', '2026-02-28'],
      ['Home', '2026-06-15', '2026-01-01'],
      ['End', '2026-06-15', '2026-10-04']
    ])('%s from %s goes to %s', (keyName, from, expected) => {
      expect(move(keyName, from, 'annual', year)).toBe(expected)
    })

    it('crosses into the next year row by date arithmetic', () => {
      const years = span('2025-10-05', '2026-10-04')

      expect(move('ArrowRight', '2025-12-28', 'annual', years)).toBe(
        '2026-01-04'
      )
      expect(move('ArrowDown', '2025-12-31', 'annual', years)).toBe(
        '2026-01-01'
      )
    })

    it('takes Home and End to the first and last day of the same year row', () => {
      const years = span('2025-10-05', '2026-10-04')

      expect(move('Home', '2025-11-20', 'annual', years)).toBe('2025-10-05')
      expect(move('End', '2025-11-20', 'annual', years)).toBe('2025-12-31')
      expect(move('Home', '2026-03-10', 'annual', years)).toBe('2026-01-01')
    })
  })

  describe('month layout: weeks are rows', () => {
    const october = span('2026-10-01', '2026-10-31')

    it.each([
      ['ArrowLeft', '2026-10-15', '2026-10-14'],
      ['ArrowRight', '2026-10-15', '2026-10-16'],
      ['ArrowUp', '2026-10-15', '2026-10-08'],
      ['ArrowDown', '2026-10-15', '2026-10-22'],
      // Thursday 15 Oct: its week runs Monday 12 to Sunday 18.
      ['Home', '2026-10-15', '2026-10-12'],
      ['End', '2026-10-15', '2026-10-18']
    ])('%s from %s goes to %s', (keyName, from, expected) => {
      expect(move(keyName, from, 'month', october)).toBe(expected)
    })

    it('clamps Home and End to the month in a partial week', () => {
      // 1 Oct 2026 is a Thursday: its week starts in September.
      expect(move('Home', '2026-10-02', 'month', october)).toBe('2026-10-01')
      expect(move('End', '2026-10-29', 'month', october)).toBe('2026-10-31')
    })

    it('clamps PageUp and PageDown to the days that exist', () => {
      expect(move('PageDown', '2026-10-15', 'month', october)).toBe(
        '2026-10-31'
      )
      expect(move('PageUp', '2026-10-15', 'month', october)).toBe('2026-10-01')
    })
  })

  describe('clamping', () => {
    it('stays put at the first and last day', () => {
      expect(move('ArrowLeft', '2026-01-01', 'annual', year)).toBeNull()
      expect(move('ArrowUp', '2026-01-01', 'annual', year)).toBeNull()
      expect(move('ArrowRight', '2026-10-04', 'annual', year)).toBeNull()
      expect(move('ArrowDown', '2026-10-04', 'annual', year)).toBeNull()
    })

    it('lands on the edge when a step would overshoot it', () => {
      expect(move('ArrowRight', '2026-09-30', 'annual', year)).toBe(
        '2026-10-04'
      )
      expect(move('ArrowLeft', '2026-01-05', 'annual', year)).toBe('2026-01-01')
    })

    it('skips days that cannot take focus (a disabled gap)', () => {
      // 3 Oct and 4 Oct are upcoming/out: only 1 and 2 Oct are focusable.
      const october = span('2026-10-01', '2026-10-02')

      expect(move('ArrowRight', '2026-10-01', 'month', october)).toBe(
        '2026-10-02'
      )
      expect(move('ArrowRight', '2026-10-02', 'month', october)).toBeNull()
    })

    it('walks back across a gap inside the range', () => {
      const gapped = [
        ...span('2026-10-01', '2026-10-03'),
        ...span('2026-10-10', '2026-10-12')
      ]

      // +7 from the 4th would be the 11th; from the 3rd it is the 10th.
      expect(move('ArrowDown', '2026-10-03', 'month', gapped)).toBe(
        '2026-10-10'
      )
      // From the 12th, -7 lands on the 5th (a gap): the nearest focusable day
      // back toward where it came from is the 10th.
      expect(move('ArrowUp', '2026-10-12', 'month', gapped)).toBe('2026-10-10')
    })

    it('ignores other keys and an empty calendar', () => {
      expect(move('a', '2026-06-15', 'annual', year)).toBeNull()
      expect(move('Enter', '2026-06-15', 'annual', year)).toBeNull()
      expect(move('ArrowRight', '2026-06-15', 'annual', [])).toBeNull()
    })
  })
})

const Harness: FC<{
  dates: DateKey[]
  layout?: RovingLayout
  preferred?: DateKey | null
  onEscape?: () => void
}> = ({ dates, layout = 'month', preferred = null, onEscape }) => {
  const roving = useRovingDateFocus({ dates, layout, preferred })
  return (
    <div>
      <button type="button" onClick={() => roving.focusDate(dates[0])}>
        focus first
      </button>
      <div
        role="group"
        aria-label="days"
        {...roving.containerProps}
        onKeyDown={(event) => {
          roving.containerProps.onKeyDown(event)
          if (event.key === 'Escape') onEscape?.()
        }}
      >
        {dates.map((date) => (
          <button
            key={date}
            type="button"
            data-date={date}
            tabIndex={date === roving.tabStopDate ? 0 : -1}
          >
            {date}
          </button>
        ))}
      </div>
    </div>
  )
}

const cell = (date: string) => screen.getByRole('button', { name: date })
const tabStops = () =>
  screen
    .getAllByRole('button')
    .filter(
      (button) =>
        button.hasAttribute('data-date') &&
        button.getAttribute('tabindex') === '0'
    )
    .map((button) => button.textContent)

describe('useRovingDateFocus', () => {
  const october = span('2026-10-01', '2026-10-10')

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('has one tab stop: the preferred day, else the last day', () => {
    const { rerender } = render(
      <Harness dates={october} preferred={key('2026-10-04')} />
    )
    expect(tabStops()).toEqual(['2026-10-04'])

    rerender(<Harness dates={october} preferred={null} />)
    expect(tabStops()).toEqual(['2026-10-10'])
  })

  it('falls back when the preferred day is not focusable', () => {
    render(<Harness dates={october} preferred={key('2027-01-01')} />)

    expect(tabStops()).toEqual(['2026-10-10'])
  })

  it('moves focus and the tab stop with the arrow keys', () => {
    render(<Harness dates={october} preferred={key('2026-10-04')} />)
    cell('2026-10-04').focus()

    fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowRight' })
    expect(cell('2026-10-05')).toHaveFocus()
    expect(tabStops()).toEqual(['2026-10-05'])

    fireEvent.keyDown(cell('2026-10-05'), { key: 'ArrowDown' })
    expect(cell('2026-10-10')).toHaveFocus()
  })

  it('handles Home, End, PageUp and PageDown and clamps at the ends', () => {
    render(<Harness dates={october} preferred={key('2026-10-08')} />)
    cell('2026-10-08').focus()

    // Thursday 8 Oct: its week runs Monday 5 to Sunday 11, cut off at the 10th.
    fireEvent.keyDown(cell('2026-10-08'), { key: 'Home' })
    expect(cell('2026-10-05')).toHaveFocus()

    fireEvent.keyDown(cell('2026-10-05'), { key: 'End' })
    expect(cell('2026-10-10')).toHaveFocus()

    fireEvent.keyDown(cell('2026-10-10'), { key: 'PageUp' })
    expect(cell('2026-10-01')).toHaveFocus()

    fireEvent.keyDown(cell('2026-10-01'), { key: 'ArrowLeft' })
    expect(cell('2026-10-01')).toHaveFocus()
  })

  it('prevents the page from scrolling on the keys it handles', () => {
    render(<Harness dates={october} preferred={key('2026-10-04')} />)
    cell('2026-10-04').focus()

    const notPrevented = fireEvent.keyDown(cell('2026-10-04'), {
      key: 'ArrowDown'
    })
    const tabNotPrevented = fireEvent.keyDown(cell('2026-10-05'), {
      key: 'Tab'
    })

    expect(notPrevented).toBe(false)
    expect(tabNotPrevented).toBe(true)
  })

  it('leaves modified arrows to the browser', () => {
    render(<Harness dates={october} preferred={key('2026-10-04')} />)
    cell('2026-10-04').focus()

    const notPrevented = fireEvent.keyDown(cell('2026-10-04'), {
      key: 'ArrowRight',
      altKey: true
    })

    expect(notPrevented).toBe(true)
    expect(cell('2026-10-04')).toHaveFocus()
  })

  it('moves the tab stop to a cell focused another way', () => {
    render(<Harness dates={october} preferred={key('2026-10-04')} />)

    act(() => cell('2026-10-08').focus())

    expect(tabStops()).toEqual(['2026-10-08'])
  })

  it('lets Escape bubble to the parent', () => {
    const onEscape = vi.fn()
    render(
      <Harness
        dates={october}
        preferred={key('2026-10-04')}
        onEscape={onEscape}
      />
    )
    cell('2026-10-04').focus()

    fireEvent.keyDown(cell('2026-10-04'), { key: 'Escape' })

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('focuses a day on request, which is how the parent restores focus', () => {
    render(<Harness dates={october} preferred={key('2026-10-04')} />)

    fireEvent.click(screen.getByRole('button', { name: 'focus first' }))

    expect(cell('2026-10-01')).toHaveFocus()
    expect(tabStops()).toEqual(['2026-10-01'])
  })

  it('re-derives the tab stop when its day disappears from the data', () => {
    const { rerender } = render(
      <Harness dates={october} preferred={key('2026-10-04')} />
    )
    cell('2026-10-08').focus()

    rerender(
      <Harness
        dates={span('2026-10-01', '2026-10-05')}
        preferred={key('2026-10-04')}
      />
    )

    expect(tabStops()).toEqual(['2026-10-04'])
  })

  describe('scrolling the focused day into view', () => {
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      scrollIntoView.mockReset()
      Element.prototype.scrollIntoView = scrollIntoView
    })

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })

    it('glides in the annual layout', () => {
      stubReducedMotion(false)
      render(
        <Harness
          dates={october}
          layout="annual"
          preferred={key('2026-10-04')}
        />
      )
      cell('2026-10-04').focus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowRight' })

      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ inline: 'nearest', behavior: 'smooth' })
      )
    })

    it('jumps instantly under prefers-reduced-motion', () => {
      stubReducedMotion(true)
      render(
        <Harness
          dates={october}
          layout="annual"
          preferred={key('2026-10-04')}
        />
      )
      cell('2026-10-04').focus()

      fireEvent.keyDown(cell('2026-10-04'), { key: 'ArrowRight' })

      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'auto' })
      )
    })
  })
})
