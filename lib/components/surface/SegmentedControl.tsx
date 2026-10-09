'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { KeyboardEvent, ReactNode, useRef } from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedControlItem {
  value: string
  label: ReactNode
  icon?: LucideIcon
  /** `asLinks` only: where the item goes. */
  href?: string
  disabled?: boolean
}

interface BaseProps {
  items: ReadonlyArray<SegmentedControlItem>
  /** The chosen item's `value` (the current page, with `asLinks`). */
  value: string
  /** Called with the new `value`; required unless `asLinks`. */
  onValueChange?: (value: string) => void
  /**
   * Tab navigation: the items are links (each needs an `href`) and the current
   * one is `aria-current="page"`, instead of in-page state with radio
   * semantics.
   */
  asLinks?: boolean
  /** `md` is a 44px touch target (the default); `sm` is 36px. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * The group needs a name: `aria-label` text, or `aria-labelledby` pointing at
 * a visible label (a `FormRow` hands its label's id to a render-prop child).
 */
type Props = BaseProps &
  (
    | {
        /** Names the group: "Shade the calendar by", "Reports". */
        'aria-label': string
        'aria-labelledby'?: never
      }
    | {
        /** The id of the element that names the group. */
        'aria-labelledby': string
        'aria-label'?: never
      }
  )

const TRACK_CLASS =
  'bg-muted flex max-w-full items-stretch sm:w-fit gap-0.5 overflow-x-auto rounded-lg shadow-[inset_0_0_0_1px_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

// The transparent border insets the painted pill (and the clipped background)
// from the track, so the pill reads as a smaller shape on a full-height track.
const SEGMENT_CLASS =
  'flex flex-[1_1_auto] cursor-pointer items-center justify-center gap-2 rounded-lg border-x border-transparent bg-clip-padding px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-offset-1 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:opacity-50 disabled:cursor-default disabled:opacity-50 sm:flex-none'

const SIZE_CLASS = {
  md: 'min-h-11 border-y-4',
  sm: 'min-h-9 border-y-2'
} as const

const stateClass = (active: boolean) =>
  active
    ? 'bg-primary text-primary-foreground'
    : 'text-foreground hover:bg-accent'

/**
 * One control for a range, a filter or a set of tabs: the Fitness calendar's
 * "Activities | Distance | Duration" track, with the active segment in the
 * brand colour. In-page state is a `radiogroup` (one tab stop, the arrow keys
 * move and choose, Home and End jump); `asLinks` makes it a `nav` of links for
 * navigation between pages. Too many segments for a phone scroll sideways
 * inside the track instead of overflowing the page.
 */
export const SegmentedControl = ({
  items,
  value,
  onValueChange,
  asLinks = false,
  size = 'md',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy
}: Props) => {
  const group = useRef<HTMLDivElement>(null)

  if (asLinks) {
    return (
      <nav
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(TRACK_CLASS, className)}
      >
        {items.map((item) => {
          const active = item.value === value
          const Icon = item.icon
          const content = (
            <>
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              {item.label}
            </>
          )
          const classes = cn(
            SEGMENT_CLASS,
            SIZE_CLASS[size],
            stateClass(active)
          )
          return item.disabled || !item.href ? (
            <span key={item.value} aria-disabled="true" className={classes}>
              {content}
            </span>
          ) : (
            <Link
              key={item.value}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={classes}
            >
              {content}
            </Link>
          )
        })}
      </nav>
    )
  }

  const enabled = items.filter((item) => !item.disabled)
  const checkedIndex = items.findIndex((item) => item.value === value)
  // The one tab stop: the checked segment, or the first enabled one when the
  // value matches nothing or matches a disabled segment, so the group is never
  // skipped by Tab.
  const tabStop =
    (checkedIndex >= 0 && !items[checkedIndex].disabled
      ? items[checkedIndex]
      : undefined) ?? enabled[0]

  // The enabled segment `direction` steps away from `from` (the focused
  // segment), wrapping around the group.
  const step = (from: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate =
        items[
          (from + direction * offset + items.length * offset) % items.length
        ]
      if (!candidate.disabled) return candidate
    }
    return undefined
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return
    // Arrows step from the focused segment (the tab stop when focus is on the
    // group itself), not from the checked value, which may be unknown or
    // disabled.
    const focused = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-value]'
    )?.dataset.value
    const from = items.findIndex((item) => item.value === focused)
    const origin =
      from >= 0 ? from : items.indexOf(tabStop as (typeof items)[0])
    let next: SegmentedControlItem | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = step(origin, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = step(origin, -1)
    } else if (event.key === 'Home') {
      next = enabled[0]
    } else if (event.key === 'End') {
      next = enabled[enabled.length - 1]
    }
    if (!next) return
    event.preventDefault()
    onValueChange?.(next.value)
    // The roving tab stop moves with the choice; focus follows it.
    group.current
      ?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)
      ?.focus()
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onKeyDown={onKeyDown}
      className={cn(TRACK_CLASS, className)}
    >
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-value={item.value}
            disabled={item.disabled}
            tabIndex={item === tabStop ? 0 : -1}
            onClick={() => onValueChange?.(item.value)}
            className={cn(SEGMENT_CLASS, SIZE_CLASS[size], stateClass(active))}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
