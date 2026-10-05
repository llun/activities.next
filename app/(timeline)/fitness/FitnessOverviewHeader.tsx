'use client'

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { FC, ReactNode, useId, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { formatMonthYear, formatRange } from '@/lib/fitness/calendar/format'
import { dateKeyParts } from '@/lib/fitness/calendar/localDay'
import {
  AppliedRange,
  RangeView,
  StepDirection,
  viewFor
} from '@/lib/fitness/calendar/ranges'
import { cn } from '@/lib/utils'

/**
 * What the applied range is called: the month in month view, otherwise the
 * year and the kind of span ("2026 · Year to date", "2025", "Last 12 months").
 */
export const overviewHeading = (range: AppliedRange): string => {
  const { year, month } = dateKeyParts(range.from)
  switch (range.kind) {
    case 'this_month':
    case 'month':
      return formatMonthYear(year, month)
    case 'ytd':
      return `${year} · Year to date`
    case 'year':
      return String(year)
    case 'last_12_months':
      return 'Last 12 months'
    case 'custom':
      return 'Custom range'
  }
}

/**
 * The calendar year a range is, for the year chooser: year to date and a past
 * calendar year name one; a month, the last 12 months or a custom span do not.
 */
export const calendarYearOf = (range: AppliedRange): number | null =>
  range.kind === 'ytd' || range.kind === 'year'
    ? dateKeyParts(range.from).year
    : null

/**
 * Whether previous/next steps (and the year chooser) apply to a range: month
 * view steps calendar months, and annual view steps calendar YEARS, which only
 * means something for one calendar year (year to date or a past year). Last 12
 * months and a custom span cross year boundaries, so they offer "Month view"
 * alone, as the designs (D08, D19) draw them.
 */
export const stepsApply = (range: AppliedRange): boolean =>
  viewFor(range) === 'month' || calendarYearOf(range) !== null

// ---------------------------------------------------------------- slots ---

export type OverviewHeaderSlotName = 'dates' | 'range'

const SLOT_ATTRIBUTE = 'data-fitness-overview-slot'

/**
 * A place in the page's own "Overview" header (rendered by the Server
 * Component page) that the dashboard fills on wide containers: the applied
 * dates as its description and the range picker as its action, as the desktop
 * and tablet designs lay them out. It is empty in the server's HTML, because
 * those dates are the viewer's local days and only the client knows the zone.
 */
export const OverviewHeaderSlot: FC<{ slot: OverviewHeaderSlotName }> = ({
  slot
}) => <span {...{ [SLOT_ATTRIBUTE]: slot }} className="contents" />

/** The slot element, once mounted; `null` when the page has none. */
const useHeaderSlot = (slot: OverviewHeaderSlotName) => {
  const [element, setElement] = useState<Element | null>(null)
  useLayoutEffect(() => {
    setElement(document.querySelector(`[${SLOT_ATTRIBUTE}="${slot}"]`))
  }, [slot])
  return element
}

/**
 * Renders `children` into a page header slot, or in place when the page has
 * no such slot (a test, or a page that does not carry one).
 */
export const InOverviewHeaderSlot: FC<{
  slot: OverviewHeaderSlotName
  children: ReactNode
}> = ({ slot, children }) => {
  const element = useHeaderSlot(slot)
  return element ? createPortal(children, element) : <>{children}</>
}

// ------------------------------------------------------------- controls ---

const STEP_LABELS = {
  month: { previous: 'Previous month', next: 'Next month' },
  annual: { previous: 'Previous year', next: 'Next year' }
} as const

/**
 * Previous/next, 44px: a calendar month in month view, a calendar year in
 * annual view, disabled when the target is wholly in the future.
 */
export const StepButtons: FC<{
  view: RangeView
  canStep: Record<StepDirection, boolean>
  onStep: (direction: StepDirection) => void
  className?: string
}> = ({ view, canStep, onStep, className }) => (
  <div className={cn('flex items-center gap-2', className)}>
    {(['previous', 'next'] as const).map((direction) => {
      const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
      return (
        <Button
          key={direction}
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={STEP_LABELS[view][direction]}
          disabled={!canStep[direction]}
          onClick={() => onStep(direction)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      )
    })}
  </div>
)

/**
 * The Training calendar toolbar's year chooser ("2026 ▾"): a menu of calendar
 * years that applies one directly. It shows "Year" when the range is not one
 * calendar year.
 */
export const CalendarYearMenu: FC<{
  years: readonly number[]
  value: number | null
  onSelect: (year: number) => void
}> = ({ years, value, onSelect }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="outline"
        className="h-11 min-w-24 justify-between gap-2 font-normal"
        aria-label={`Calendar year: ${value ?? 'none chosen'}`}
      >
        <span aria-hidden="true">{value ?? 'Year'}</span>
        <ChevronDown
          className="text-muted-foreground size-4"
          aria-hidden="true"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      className="max-h-60 w-(--radix-dropdown-menu-trigger-width) min-w-28"
    >
      <DropdownMenuRadioGroup
        value={value === null ? '' : String(value)}
        onValueChange={(next) => {
          const year = Number(next)
          if (Number.isInteger(year)) onSelect(year)
        }}
      >
        {years.map((year) => (
          <DropdownMenuRadioItem
            key={year}
            value={String(year)}
            className="pointer-coarse:min-h-11"
          >
            {year}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)

/** The exact inclusive dates of a range: "1 Jan – 4 Oct 2026", "1 – 4 Oct 2026". */
export const OverviewDates: FC<{ range: AppliedRange; loading?: boolean }> = ({
  range,
  loading = false
}) => (
  <span
    data-testid="fitness-overview-dates"
    className={cn('transition-opacity duration-150', loading && 'opacity-60')}
  >
    {formatRange(range.from, range.to)}
  </span>
)

// --------------------------------------------------------------- header ---

interface Props {
  /** The range the page is showing (the previous one after a failed read). */
  range: AppliedRange
  /** Whether the previous/next step has a target (not wholly in the future). */
  canStep: Record<StepDirection, boolean>
  onStep: (direction: StepDirection) => void
  /** The range picker's trigger (and the panel it opens). */
  rangePicker: ReactNode
  /** Grey the dates while the new range loads; the layout stays put. */
  loading?: boolean
  className?: string
}

/**
 * The narrow-container period heading, directly below the page's "Overview"
 * title (the phone designs): what the range is, its exact inclusive dates,
 * then previous/next and the range picker on one row. Wide containers carry
 * the dates and the picker in the page header instead, and the steps in the
 * Training calendar toolbar.
 */
export const FitnessOverviewHeader: FC<Props> = ({
  range,
  canStep,
  onStep,
  rangePicker,
  loading = false,
  className
}) => {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      data-testid="fitness-overview-header"
      className={cn('space-y-3', className)}
    >
      <div className="min-w-0">
        <h2 id={headingId} className="text-xl font-semibold break-words">
          {overviewHeading(range)}
        </h2>
        <p className="text-muted-foreground text-sm">
          <OverviewDates range={range} loading={loading} />
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {stepsApply(range) && (
          <StepButtons
            view={viewFor(range)}
            canStep={canStep}
            onStep={onStep}
            className={cn(
              'transition-opacity duration-150',
              loading && 'opacity-60'
            )}
          />
        )}
        <div className="ml-auto">{rangePicker}</div>
      </div>
    </section>
  )
}
