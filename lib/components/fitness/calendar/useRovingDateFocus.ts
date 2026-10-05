'use client'

import {
  FocusEvent,
  KeyboardEvent,
  RefObject,
  useCallback,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  DateKey,
  addDays,
  addMonthsClamped,
  compareDateKeys,
  weekdayMon0
} from '@/lib/fitness/calendar/localDay'

import { scrollBehavior } from './calendarShared'

/**
 * How the days are laid out, which decides what each arrow means:
 * - `annual`: weeks are columns, so Left/Right move a week and Up/Down a day.
 * - `month`: weeks are rows, so Left/Right move a day and Up/Down a week.
 */
export type RovingLayout = 'annual' | 'month'

export const ROVING_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown'
] as const

export type RovingKey = (typeof ROVING_KEYS)[number]

export const isRovingKey = (key: string): key is RovingKey =>
  (ROVING_KEYS as readonly string[]).includes(key)

const MAX_GAP_STEPS = 400

/**
 * Where a key moves focus from `from`, or `null` when it does not move (the
 * edge was reached or the key is not one of ours).
 *
 * - Arrows step by the layout's day or week.
 * - Home/End: the first/last day of the year row (annual) or of the week
 *   (month).
 * - PageUp/PageDown: one month back/forward, the day clamped to the month.
 *
 * Movement is clamped to `dates`, the focusable days in ascending order: a
 * target past either end lands on that end, and a target inside a gap (a
 * disabled day) walks back toward `from` until a focusable day is found. Cells
 * that cannot take focus (out of range, upcoming) are never returned.
 */
export const nextRovingDate = ({
  key,
  from,
  layout,
  dates,
  enabled
}: {
  key: string
  from: DateKey
  layout: RovingLayout
  dates: readonly DateKey[]
  enabled: ReadonlySet<DateKey>
}): DateKey | null => {
  if (!isRovingKey(key) || dates.length === 0) return null
  const first = dates[0]
  const last = dates[dates.length - 1]

  const dayStep = layout === 'annual' ? { h: 7, v: 1 } : { h: 1, v: 7 }
  let target: DateKey
  switch (key) {
    case 'ArrowLeft':
      target = addDays(from, -dayStep.h)
      break
    case 'ArrowRight':
      target = addDays(from, dayStep.h)
      break
    case 'ArrowUp':
      target = addDays(from, -dayStep.v)
      break
    case 'ArrowDown':
      target = addDays(from, dayStep.v)
      break
    case 'PageUp':
      target = addMonthsClamped(from, -1)
      break
    case 'PageDown':
      target = addMonthsClamped(from, 1)
      break
    case 'Home':
    case 'End': {
      const isHome = key === 'Home'
      if (layout === 'annual') {
        const year = from.slice(0, 4)
        const inYear = dates.filter((date) => date.startsWith(year))
        target = (isHome ? inYear[0] : inYear[inYear.length - 1]) ?? from
      } else {
        target = addDays(
          from,
          isHome ? -weekdayMon0(from) : 6 - weekdayMon0(from)
        )
      }
      break
    }
  }

  if (compareDateKeys(target, last) > 0) target = last
  else if (compareDateKeys(target, first) < 0) target = first

  if (!enabled.has(target)) {
    // Inside a gap: step toward where we came from until a day can be focused.
    const toward = compareDateKeys(target, from) > 0 ? -1 : 1
    let candidate = target
    for (let step = 0; step < MAX_GAP_STEPS; step += 1) {
      candidate = addDays(candidate, toward)
      if (candidate === from) return null
      if (enabled.has(candidate)) {
        target = candidate
        break
      }
    }
    if (!enabled.has(target)) return null
  }
  return target === from ? null : target
}

export interface RovingDateFocusOptions {
  /** The focusable days, ascending. Everything else is skipped. */
  dates: readonly DateKey[]
  layout: RovingLayout
  /**
   * The tab stop when nothing has been focused yet: usually the selected day,
   * else today. Falls back to the last focusable day.
   */
  preferred?: DateKey | null
}

export interface RovingDateFocus {
  /** The one cell with `tabIndex={0}`; every other cell is `-1`. */
  tabStopDate: DateKey | null
  /** Spread on the element that contains the cells (keys and focus bubble). */
  containerProps: {
    ref: RefObject<HTMLDivElement | null>
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
    onFocus: (event: FocusEvent<HTMLElement>) => void
  }
  /** Moves focus (and the tab stop) to a day's cell and scrolls it into view. */
  focusDate: (date: DateKey, options?: { smooth?: boolean }) => void
}

/**
 * One tab stop for the whole calendar, with the arrow keys moving between days
 * (the roving tabindex pattern). The cells carry `data-date`; this hook never
 * holds a ref per cell, so a year of 366 buttons costs one handler.
 *
 * Escape and selection belong to the parent: Enter and Space are the buttons'
 * own, and Escape bubbles untouched so the parent can close the day details and
 * restore focus with `focusDate`.
 */
export const useRovingDateFocus = ({
  dates,
  layout,
  preferred = null
}: RovingDateFocusOptions): RovingDateFocus => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<DateKey | null>(null)
  const enabled = useMemo(() => new Set(dates), [dates])

  // The last focused day while it can still be focused, else the preferred one,
  // else the last day: derived on render, so a data change can never strand
  // the tab stop on a cell that no longer exists.
  const tabStopDate =
    focused && enabled.has(focused)
      ? focused
      : preferred && enabled.has(preferred)
        ? preferred
        : (dates[dates.length - 1] ?? null)

  const focusDate = useCallback(
    (date: DateKey, options?: { smooth?: boolean }) => {
      setFocused(date)
      const cell = containerRef.current?.querySelector<HTMLElement>(
        `[data-date="${date}"]`
      )
      if (!cell) return
      cell.focus({ preventScroll: true })
      // The scroller's scroll-padding keeps the cell clear of the sticky
      // labels and the edge fade. jsdom has no scrollIntoView.
      cell.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
        behavior: options?.smooth ? scrollBehavior() : 'auto'
      })
    },
    []
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }
      if (!isRovingKey(event.key)) return
      const cell = (event.target as Element).closest<HTMLElement>('[data-date]')
      const from = cell?.dataset.date as DateKey | undefined
      if (!cell || !from || !event.currentTarget.contains(cell)) return
      // These keys would scroll the page; they belong to the calendar here.
      event.preventDefault()
      const next = nextRovingDate({
        key: event.key,
        from,
        layout,
        dates,
        enabled
      })
      if (next) focusDate(next, { smooth: layout === 'annual' })
    },
    [dates, enabled, focusDate, layout]
  )

  // Focus that arrives any other way (Tab, a click, a screen reader) moves the
  // tab stop with it, so Shift+Tab out and back returns to the same day.
  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const date = (event.target as Element).closest<HTMLElement>('[data-date]')
      ?.dataset.date as DateKey | undefined
    if (date) setFocused(date)
  }, [])

  return {
    tabStopDate,
    containerProps: { ref: containerRef, onKeyDown, onFocus },
    focusDate
  }
}
