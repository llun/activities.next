'use client'

import { AlertTriangle, ChevronRight, RefreshCw, X } from 'lucide-react'
import Link from 'next/link'
import { KeyboardEvent, useId } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  formatActivityCount,
  formatDistance,
  formatDuration,
  formatFullDate,
  formatLocalTime
} from '@/lib/fitness/calendar/format'
import { DateKey } from '@/lib/fitness/calendar/localDay'
import {
  FitnessCalendarDay,
  FitnessDayActivity
} from '@/lib/fitness/calendar/types'
import {
  formatActivityTypeLabel,
  getActivityPresentation
} from '@/lib/services/fitness-files/activityPresentation'
import { cn } from '@/lib/utils'

/** What the header totals line needs from the calendar's bucket for the day. */
export type DayTotals = Pick<
  FitnessCalendarDay,
  'count' | 'totalDistanceMeters' | 'totalDurationSeconds'
>

/**
 * Data and callbacks of the day details, shared by the inline region and the
 * mobile sheet. Everything is a prop: the fetching hook belongs to the
 * dashboard, and a failed or slow fetch never clears the selected date.
 */
export interface DayDetailsContentProps {
  /** The selected day. It stays on screen while loading or after an error. */
  date: DateKey
  /** The viewer's IANA zone, for the rows' local start times. */
  timeZone: string
  /** The calendar bucket for the day; `null` for a day with no activity. */
  totals: DayTotals | null
  /** Rows loaded so far, in order. */
  activities: readonly FitnessDayActivity[]
  /** The first page (or a reload) is in flight. */
  loading: boolean
  /** A further page is in flight. */
  loadingMore?: boolean
  /** The last request failed; the loaded rows stay. */
  error: boolean
  /** More rows exist beyond `activities`. */
  hasMore: boolean
  onRetry: () => void
  onLoadMore: () => void
  /** Close button or Escape. The parent restores focus to the day's cell. */
  onClose: () => void
}

/** "2 activities · 42.6 km · 1h 54m", or "0 activities" for an empty day. */
export const formatDayTotals = (totals: DayTotals | null): string => {
  if (totals === null || totals.count === 0) return formatActivityCount(0)
  return [
    formatActivityCount(totals.count),
    formatDistance(totals.totalDistanceMeters),
    formatDuration(totals.totalDurationSeconds)
  ].join(' · ')
}

/** Screen-reader announcement for a day whose details finished loading. */
export const dayAnnouncement = (
  date: DateKey,
  totals: DayTotals | null,
  count: number
): string =>
  `${formatFullDate(date)}, ${formatActivityCount(totals?.count ?? count)}`

export const CLOSE_LABEL = 'Close day details'

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label={CLOSE_LABEL}
      onClick={onClose}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
    >
      <X className="size-5" aria-hidden="true" />
    </button>
  )
}

export const closeOnEscape =
  (onClose: () => void) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

const localTime = (startTime: number, timeZone: string): string | null => {
  try {
    return formatLocalTime(startTime, timeZone)
  } catch {
    // An unknown zone only costs the time; the row is still real.
    return null
  }
}

export function ActivityRow({
  activity,
  timeZone
}: {
  activity: FitnessDayActivity
  timeZone: string
}) {
  const typeLabel = activity.activityType
    ? formatActivityTypeLabel(activity.activityType)
    : 'Activity'
  const available = activity.statusPath !== null
  const heading = activity.title ?? typeLabel
  const time = localTime(activity.startTime, timeZone)
  const subtitle = [
    activity.title !== null ? typeLabel : null,
    time,
    available ? null : 'Linked post unavailable'
  ]
    .filter(Boolean)
    .join(' · ')

  const body = (
    <>
      <span
        aria-hidden="true"
        className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg text-lg"
      >
        {getActivityPresentation(activity.activityType).emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm font-medium break-words',
            !available && 'text-muted-foreground'
          )}
        >
          {heading}
        </span>
        {subtitle && (
          <span className="text-muted-foreground block text-xs break-words">
            {subtitle}
          </span>
        )}
      </span>
      <span
        className={cn(
          'shrink-0 text-right text-sm tabular-nums',
          !available && 'text-muted-foreground'
        )}
      >
        {activity.totalDistanceMeters !== null && (
          <span className="block font-medium">
            {formatDistance(activity.totalDistanceMeters)}
          </span>
        )}
        {activity.totalDurationSeconds !== null && (
          <span className="text-muted-foreground block text-xs">
            {formatDuration(activity.totalDurationSeconds)}
          </span>
        )}
      </span>
      {/* Keeps the figures aligned between linked and unlinked rows. */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {available && (
          <ChevronRight
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
        )}
      </span>
    </>
  )

  const rowClass = 'flex min-h-14 items-center gap-3 py-2'
  return (
    <li className="border-b last:border-b-0" data-testid="day-activity-row">
      {activity.statusPath !== null ? (
        // One link per row of a list: no viewport prefetching.
        <Link
          href={activity.statusPath}
          prefetch={false}
          className={cn(
            rowClass,
            'hover:bg-accent/50 focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2'
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  )
}

function LoadingRows() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-3 py-3"
      data-testid="day-details-loading"
    >
      <span className="sr-only">Loading activities</span>
      {[0, 1].map((index) => (
        <div key={index} className="flex items-center gap-3" aria-hidden="true">
          <span className="size-10 shrink-0 rounded-lg skeleton" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="block h-4 w-40 rounded skeleton" />
            <span className="block h-3 w-24 rounded skeleton" />
          </span>
        </div>
      ))}
    </div>
  )
}

interface DayDetailsBodyProps {
  activities: readonly FitnessDayActivity[]
  timeZone: string
  loading: boolean
  loadingMore?: boolean
  error: boolean
  hasMore: boolean
  onRetry: () => void
  onLoadMore: () => void
  /** Show only this many rows (the collapsed sheet) and no pagination. */
  limit?: number
}

/** Loading, error, empty and row states of a day's activity list. */
export function DayDetailsBody({
  activities,
  timeZone,
  loading,
  loadingMore = false,
  error,
  hasMore,
  onRetry,
  onLoadMore,
  limit
}: DayDetailsBodyProps) {
  const rows = limit === undefined ? activities : activities.slice(0, limit)
  const showEmpty = !loading && !error && activities.length === 0
  return (
    <div>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-y py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <AlertTriangle
              className="text-destructive-text size-4 shrink-0"
              aria-hidden="true"
            />
            We couldn’t load the activities for this day.
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={onRetry}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}
      {loading && activities.length === 0 && !error && <LoadingRows />}
      {showEmpty && (
        <p className="text-muted-foreground border-t py-3 text-sm">
          No recorded activities
        </p>
      )}
      {rows.length > 0 && (
        <ul
          aria-busy={loading || undefined}
          className={cn(
            'border-t transition-opacity duration-150',
            loading && 'opacity-60'
          )}
        >
          {rows.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
      {limit === undefined && hasMore && (
        <div className="flex justify-center py-3">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The day's details, inline below the calendar grid (desktop and tablet): the
 * full date, a totals line, the activities, and states for loading, failure
 * (with Retry), an empty day and pagination. Fades in over 150ms.
 */
export function DayDetails({
  date,
  timeZone,
  totals,
  activities,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
  onClose
}: DayDetailsContentProps) {
  const headingId = useId()
  const settled = !loading && !error
  return (
    <section
      aria-labelledby={headingId}
      data-testid="day-details"
      className="animate-in fade-in-0 border-t duration-150"
      onKeyDown={closeOnEscape(onClose)}
    >
      <header className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-xl font-semibold">
            {formatFullDate(date)}
          </h3>
          <p className="text-muted-foreground text-sm">
            {formatDayTotals(totals)}
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {settled ? dayAnnouncement(date, totals, activities.length) : ''}
      </p>
      <DayDetailsBody
        activities={activities}
        timeZone={timeZone}
        loading={loading}
        loadingMore={loadingMore}
        error={error}
        hasMore={hasMore}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
      />
    </section>
  )
}
