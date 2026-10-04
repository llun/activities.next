'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { FC, ReactNode, useId } from 'react'

import { Button } from '@/lib/components/ui/button'
import { formatMonthYear, formatRange } from '@/lib/fitness/calendar/format'
import { dateKeyParts } from '@/lib/fitness/calendar/localDay'
import {
  AppliedRange,
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

interface Props {
  applied: AppliedRange
  /** Whether the previous/next step has a target (not wholly in the future). */
  canStep: Record<StepDirection, boolean>
  onStep: (direction: StepDirection) => void
  /** Annual view: open the latest month in the range. */
  onOpenLatestMonth: () => void
  /** Month view: restore the annual range month view was opened from. */
  onBackToYear: () => void
  /** The range picker's trigger (and the panel it opens). */
  rangePicker: ReactNode
  /** Grey the heading while the new range loads; the layout stays put. */
  loading?: boolean
  className?: string
}

const STEP_LABELS = {
  month: { previous: 'Previous month', next: 'Next month' },
  annual: { previous: 'Previous year', next: 'Next year' }
} as const

/**
 * The overview's period heading, directly below the page's "Overview" title:
 * what the applied range is, its exact inclusive dates, previous/next (a
 * calendar month in month view, a calendar year in annual view, disabled when
 * the target is wholly in the future), the range picker, and "Month view" or
 * "Back to year".
 *
 * It wraps rather than clips: the title block takes the free width and the
 * controls drop below it on a narrow container. Every control is 44px.
 */
export const FitnessOverviewHeader: FC<Props> = ({
  applied,
  canStep,
  onStep,
  onOpenLatestMonth,
  onBackToYear,
  rangePicker,
  loading = false,
  className
}) => {
  const headingId = useId()
  const view = viewFor(applied)
  const labels = STEP_LABELS[view]
  return (
    <section
      aria-labelledby={headingId}
      data-testid="fitness-overview-header"
      className={cn('flex flex-wrap items-end gap-x-4 gap-y-3', className)}
    >
      <div className="min-w-0 flex-[1_1_16rem]">
        <h2 id={headingId} className="text-xl font-semibold break-words">
          {overviewHeading(applied)}
        </h2>
        <p
          className={cn(
            'text-muted-foreground text-sm transition-opacity duration-150',
            loading && 'opacity-60'
          )}
        >
          {formatRange(applied.from, applied.to)}
        </p>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          {(['previous', 'next'] as const).map((direction) => {
            const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
            return (
              <Button
                key={direction}
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={labels[direction]}
                disabled={!canStep[direction]}
                onClick={() => onStep(direction)}
              >
                <Icon className="size-4" aria-hidden="true" />
              </Button>
            )
          })}
        </div>
        {rangePicker}
        {view === 'annual' ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-1"
            onClick={onOpenLatestMonth}
          >
            Month view
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-1"
            onClick={onBackToYear}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to year
          </Button>
        )}
      </div>
    </section>
  )
}
