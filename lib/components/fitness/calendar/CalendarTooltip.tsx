'use client'

import {
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import { DateKey } from '@/lib/fitness/calendar/localDay'

import { CALENDAR_MOTION, dateOfElement } from './calendarShared'

/* -------------------------------------------------------------------------- */
/* Placement (pure)                                                            */
/* -------------------------------------------------------------------------- */

export const TOOLTIP_GAP = 8
export const TOOLTIP_VIEWPORT_MARGIN = 8

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface TooltipPlacement {
  x: number
  y: number
  side: 'top' | 'bottom'
}

const intersects = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const clamp = (min: number, value: number, max: number) =>
  Math.min(Math.max(min, value), Math.max(min, max))

/**
 * Where to put the tooltip so it never clips the viewport and never covers the
 * cell it describes. It sits above the cell, centred, and:
 * - flips below when there is no room above, or when above would cover one of
 *   the `avoid` boxes (the month labels, the weekday header);
 * - is clamped to the viewport horizontally with an 8px margin.
 * With no room on either side it takes the side with more space.
 */
export const placeTooltip = ({
  anchor,
  size,
  viewport,
  avoid = []
}: {
  anchor: Box
  size: { width: number; height: number }
  viewport: { width: number; height: number }
  avoid?: readonly Box[]
}): TooltipPlacement => {
  const x = clamp(
    TOOLTIP_VIEWPORT_MARGIN,
    (anchor.left + anchor.right) / 2 - size.width / 2,
    viewport.width - size.width - TOOLTIP_VIEWPORT_MARGIN
  )
  const aboveY = anchor.top - size.height - TOOLTIP_GAP
  const belowY = anchor.bottom + TOOLTIP_GAP
  const boxAt = (y: number): Box => ({
    left: x,
    top: y,
    right: x + size.width,
    bottom: y + size.height
  })

  const aboveFits =
    aboveY >= TOOLTIP_VIEWPORT_MARGIN &&
    !avoid.some((box) => intersects(boxAt(aboveY), box))
  if (aboveFits) return { x, y: aboveY, side: 'top' }

  const belowFits =
    belowY + size.height <= viewport.height - TOOLTIP_VIEWPORT_MARGIN
  if (belowFits) return { x, y: belowY, side: 'bottom' }

  // Neither side is clear: use the roomier one, kept inside the viewport.
  const roomAbove = anchor.top
  const roomBelow = viewport.height - anchor.bottom
  return roomAbove > roomBelow
    ? {
        x,
        y: clamp(
          TOOLTIP_VIEWPORT_MARGIN,
          aboveY,
          viewport.height - size.height - TOOLTIP_VIEWPORT_MARGIN
        ),
        side: 'top'
      }
    : {
        x,
        y: clamp(
          TOOLTIP_VIEWPORT_MARGIN,
          belowY,
          viewport.height - size.height - TOOLTIP_VIEWPORT_MARGIN
        ),
        side: 'bottom'
      }
}

const boxOf = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom
})

/* -------------------------------------------------------------------------- */
/* Controller                                                                  */
/* -------------------------------------------------------------------------- */

export interface CalendarTooltipTarget {
  date: DateKey
  element: HTMLElement
  /** How it was summoned: a hover waits 150ms, a keyboard focus does not. */
  mode: 'hover' | 'focus'
}

export interface CalendarTooltipController {
  /** The day to describe, or `null` (nothing hovered, or the day is pinned). */
  target: CalendarTooltipTarget | null
  hide: () => void
  /** Spread on the element that contains the cells; events bubble to it. */
  containerProps: {
    onPointerOver: (event: PointerEvent<HTMLElement>) => void
    onPointerLeave: () => void
    onFocus: (event: FocusEvent<HTMLElement>) => void
    onBlur: () => void
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  }
  /** Hides a hover tooltip when the scroller moves under the pointer. */
  onScroll: () => void
}

const isFocusVisible = (element: Element): boolean => {
  try {
    return element.matches(':focus-visible')
  } catch {
    // An engine without `:focus-visible`: a focus we were told about is more
    // likely the keyboard than not.
    return true
  }
}

/**
 * Hover and focus state for the one tooltip of a calendar.
 *
 * - A hover shows it after 150ms; a keyboard focus shows it at once.
 * - Touch pointers never show it (a tap selects; the details are on screen).
 * - The pinned (selected) day never shows it: its details are already open.
 * - It hides on blur, Escape (which still bubbles to the parent), selection
 *   and, for a hover, scrolling.
 *
 * Only cells that are `data-state="active"` are described.
 */
export const useCalendarTooltip = ({
  suppressedDate,
  hoverDelayMs = CALENDAR_MOTION.tooltipHoverDelayMs
}: {
  suppressedDate: DateKey | null
  hoverDelayMs?: number
}): CalendarTooltipController => {
  const [target, setTarget] = useState<CalendarTooltipTarget | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetRef = useRef(target)
  targetRef.current = target

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setTarget(null)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  const onPointerOver = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return
      const hit = dateOfElement(event.target as Element, event.currentTarget)
      if (hit && hit.element.dataset.state !== 'active') {
        hide()
        return
      }
      if (hit && hit.element === targetRef.current?.element) return
      hide()
      if (!hit) return
      timer.current = setTimeout(() => {
        timer.current = null
        setTarget({ ...hit, mode: 'hover' })
      }, hoverDelayMs)
    },
    [hide, hoverDelayMs]
  )

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const hit = dateOfElement(event.target as Element, event.currentTarget)
      if (!hit || hit.element.dataset.state !== 'active') return
      if (!isFocusVisible(hit.element)) return
      clearTimer()
      setTarget({ ...hit, mode: 'focus' })
    },
    [clearTimer]
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') hide()
    },
    [hide]
  )

  const onScroll = useCallback(() => {
    if (targetRef.current?.mode === 'hover') hide()
  }, [hide])

  const visible = target && target.date !== suppressedDate ? target : null

  return useMemo(
    () => ({
      target: visible,
      hide,
      containerProps: {
        onPointerOver,
        onPointerLeave: hide,
        onFocus,
        onBlur: hide,
        onKeyDown
      },
      onScroll
    }),
    [visible, hide, onPointerOver, onFocus, onKeyDown, onScroll]
  )
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export interface CalendarTooltipProps {
  target: CalendarTooltipTarget | null
  /** The full date, and the day's values. */
  content: { title: string; detail: string } | null
  /**
   * Boxes the tooltip must not cover when it sits above the cell: the month
   * labels, the weekday header. Read when the tooltip is placed.
   */
  getAvoidBoxes?: () => Box[]
}

interface Shown {
  target: CalendarTooltipTarget
  content: { title: string; detail: string }
}

/**
 * The one tooltip of a calendar, portalled to the body so no scroller or
 * container clips it. It is `aria-hidden`: every cell's accessible name already
 * carries the same words, so a screen reader hears them once.
 *
 * It fades in over 100ms and out over 75ms (opacity only, which reduced motion
 * keeps) and never takes the pointer.
 */
export const CalendarTooltip = ({
  target,
  content,
  getAvoidBoxes
}: CalendarTooltipProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null)
  const [visible, setVisible] = useState(false)
  const avoidRef = useRef(getAvoidBoxes)
  avoidRef.current = getAvoidBoxes

  // What is drawn lags `target` by one fade so the text does not vanish while
  // it fades out.
  useLayoutEffect(() => {
    if (target && content) setShown({ target, content })
    else setVisible(false)
  }, [target, content])

  const place = useCallback(() => {
    const tip = ref.current
    const current = shown?.target
    if (!tip || !current) return
    if (!current.element.isConnected) {
      setVisible(false)
      return
    }
    const anchor = current.element.getBoundingClientRect()

    // A cell scrolled out of its scroller (under the sticky labels, past the
    // edge) has nothing on screen to describe.
    const boundary = current.element.closest<HTMLElement>(
      '[data-tooltip-boundary]'
    )
    if (boundary) {
      const bounds = boundary.getBoundingClientRect()
      const inset = Number(boundary.dataset.tooltipInsetStart ?? 0)
      if (anchor.right <= bounds.left + inset || anchor.left >= bounds.right) {
        setVisible(false)
        return
      }
    }

    const tipRect = tip.getBoundingClientRect()
    const next = placeTooltip({
      anchor: boxOf(anchor),
      size: { width: tipRect.width, height: tipRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      avoid: avoidRef.current?.() ?? []
    })
    setPlacement((previous) =>
      previous &&
      previous.x === next.x &&
      previous.y === next.y &&
      previous.side === next.side
        ? previous
        : next
    )
    setVisible(true)
  }, [shown])

  useLayoutEffect(() => {
    if (shown && target) place()
  }, [shown, target, place])

  // Follow the cell while the page or its scroller moves (a keyboard focus can
  // scroll the grid under a visible tooltip).
  useEffect(() => {
    if (!target) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        place()
      })
    }
    window.addEventListener('scroll', schedule, {
      capture: true,
      passive: true
    })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [target, place])

  if (!shown) return null

  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      data-slot="calendar-tooltip"
      data-visible={visible && !!placement}
      data-side={placement?.side}
      className="bg-foreground text-background pointer-events-none fixed top-0 left-0 z-50 w-max max-w-[calc(100vw-16px)] rounded-md px-2.5 py-1.5 text-xs leading-snug"
      style={{
        transform: `translate(${placement?.x ?? 0}px, ${placement?.y ?? 0}px)`,
        opacity: visible && placement ? 1 : 0,
        visibility: visible && placement ? 'visible' : 'hidden',
        transition:
          visible && placement
            ? 'opacity var(--fitness-t-tip-in) linear, visibility 0s'
            : 'opacity var(--fitness-t-tip-out) linear, visibility 0s linear var(--fitness-t-tip-out)'
      }}
    >
      <div className="font-semibold">{shown.content.title}</div>
      <div>{shown.content.detail}</div>
    </div>,
    document.body
  )
}
