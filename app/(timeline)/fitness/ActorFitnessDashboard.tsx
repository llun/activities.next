'use client'

import { AlertTriangle, CalendarDays, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'

import {
  AnnualCalendar,
  AnnualCalendarHandle
} from '@/lib/components/fitness/calendar/AnnualCalendar'
import { CalendarLegend } from '@/lib/components/fitness/calendar/CalendarLegend'
import { DayDetails } from '@/lib/components/fitness/calendar/DayDetails'
import { DayDetailsSheet } from '@/lib/components/fitness/calendar/DayDetailsSheet'
import { MetricSelector } from '@/lib/components/fitness/calendar/MetricSelector'
import {
  MonthCalendar,
  MonthCalendarHandle
} from '@/lib/components/fitness/calendar/MonthCalendar'
import { MonthDayList } from '@/lib/components/fitness/calendar/MonthDayList'
import { RangePicker } from '@/lib/components/fitness/calendar/RangePicker'
import { scrollBehavior } from '@/lib/components/fitness/calendar/calendarShared'
import { useElementWidth } from '@/lib/components/fitness/calendar/useElementWidth'
import { Button } from '@/lib/components/ui/button'
import { formatMonthShort, formatRange } from '@/lib/fitness/calendar/format'
import { monthNeedsListAlternative } from '@/lib/fitness/calendar/geometry'
import {
  DateKey,
  dateKeyParts,
  localDateKeyAt
} from '@/lib/fitness/calendar/localDay'
import {
  createOverviewState,
  getStepTarget,
  overviewReducer
} from '@/lib/fitness/calendar/overviewState'
import {
  AppliedRange,
  viewFor,
  yearsForChooser
} from '@/lib/fitness/calendar/ranges'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { cn } from '@/lib/utils'

import { ActivityTypeBreakdown } from './ActivityTypeBreakdown'
import { FitnessOverviewHeader } from './FitnessOverviewHeader'
import { FitnessSummaryStrip, summaryTotals } from './FitnessSummaryStrip'
import { useFitnessDayActivities } from './useFitnessDayActivities'
import { useFitnessOverviewData } from './useFitnessOverviewData'
import { useViewerTimeZone } from './useViewerTimeZone'

/**
 * Below this dashboard width the day details are the mobile bottom sheet;
 * from it up (desktop, tablet portrait and landscape) they sit inline below
 * the grid. Measured on the dashboard's own column, never the viewport.
 */
export const INLINE_DETAILS_MIN_WIDTH = 600

interface Props {
  actorId: string
  /** The server's clock when the page rendered; "today" is derived from it. */
  currentTime: number
  /**
   * The stored `activityType` the recent-activities feed below is filtered to,
   * straight off the page's `?activity=` search param. Owned by the URL rather
   * than by this component so the server render that filters the feed and the
   * row that reads as selected can never disagree.
   */
  selectedActivityType?: string
  /** The actor's earliest countable activity (epoch ms), for the year chooser. */
  earliestActivityTime?: number | null
}

/**
 * The fitness overview: the period heading with its range picker, the totals,
 * the training calendar (annual or month view) with the selected day's
 * details, and the activity-type breakdown.
 *
 * Calendar days are the viewer's local days, and the server does not know the
 * viewer's zone, so until it is known (the server render and hydration) this
 * renders a structural skeleton with no dates at all. The overview proper
 * mounts on the first client render after that.
 */
export const ActorFitnessDashboard: FC<Props> = (props) => {
  const timeZone = useViewerTimeZone()
  if (timeZone === null) return <OverviewSkeleton />
  return <FitnessOverview {...props} timeZone={timeZone} />
}

function OverviewSkeleton() {
  return (
    <div
      data-testid="fitness-overview-skeleton"
      aria-busy="true"
      className="@container/fitness space-y-6"
    >
      <p role="status" className="sr-only">
        Loading your fitness overview
      </p>
      <div aria-hidden="true" className="flex flex-wrap items-end gap-3">
        <div className="flex-[1_1_16rem] space-y-2">
          <span className="skeleton block h-6 w-44 rounded" />
          <span className="skeleton block h-4 w-32 rounded" />
        </div>
        <span className="skeleton block h-11 w-56 rounded-md" />
      </div>
      <FitnessSummaryStrip
        totals={null}
        loading
        className="bg-border overflow-hidden rounded-lg border"
      />
      <div aria-hidden="true" className="space-y-4">
        <span className="skeleton block h-5 w-36 rounded" />
        <span className="skeleton block h-11 w-full max-w-80 rounded-lg" />
        <span className="skeleton block h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}

type MonthLayout = 'grid' | 'list'

const NO_DAYS: readonly FitnessCalendarDay[] = []

/** "Activity through 4 Oct" for the current month, else its exact dates. */
const monthCaption = (range: AppliedRange, today: DateKey): string => {
  if (range.to === today) {
    const { day, month } = dateKeyParts(today)
    return `Activity through ${day} ${formatMonthShort(month)}`
  }
  return formatRange(range.from, range.to)
}

function FitnessOverview({
  actorId,
  currentTime,
  selectedActivityType,
  earliestActivityTime = null,
  timeZone
}: Props & { timeZone: string }) {
  const [state, dispatch] = useReducer(overviewReducer, undefined, () =>
    createOverviewState(localDateKeyAt(currentTime, timeZone))
  )
  const { applied, today, selectedDate, metric } = state
  const view = viewFor(applied)

  // "Today" moves at midnight and with the viewer's zone: re-derive it when
  // the page comes back into view (a tab left open overnight), and at once if
  // the zone itself changed.
  const derivedZone = useRef(timeZone)
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      dispatch({
        type: 'SET_TODAY',
        today: localDateKeyAt(Date.now(), timeZone)
      })
    }
    if (derivedZone.current !== timeZone) {
      derivedZone.current = timeZone
      refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [timeZone])

  // Layout only: these widths choose a presentation and never touch the
  // reducer, so a resize or rotation keeps the range, day, metric and view.
  const [rootRef, width] = useElementWidth<HTMLDivElement>()
  const compact = width !== null && width < INLINE_DETAILS_MIN_WIDTH
  const listAvailable = width !== null && monthNeedsListAlternative(width)
  const [monthLayout, setMonthLayout] = useState<MonthLayout>('grid')
  const showList = view === 'month' && listAvailable && monthLayout === 'list'

  const data = useFitnessOverviewData({ actorId, range: applied, timeZone })
  const { status, result } = data
  const loading = status === 'loading'
  // What the summary, grid and breakdown draw. On success that is the applied
  // range; after a failure it is the last committed result, labelled as the
  // previous range's; while loading, and after a failure with nothing to fall
  // back on, the applied range's structure without data.
  const shown = status === 'success' || status === 'error' ? result : null
  const showingPrevious = status === 'error' && result !== null
  const unavailable = status === 'error' && result === null
  const gridRange = shown?.range ?? applied
  const gridView = viewFor(gridRange)
  const gridDays = shown?.days ?? NO_DAYS

  // The day's totals come from the calendar bucket, from the latest committed
  // read: it is the same day either way, so a selection kept across a reload
  // never flashes "0 activities".
  const bucketIndex = useMemo(
    () => new Map((result?.days ?? NO_DAYS).map((day) => [day.date, day])),
    [result]
  )
  const selectedTotals =
    selectedDate === null ? null : (bucketIndex.get(selectedDate) ?? null)
  const dayActivities = useFitnessDayActivities({
    actorId,
    date: selectedDate,
    timeZone
  })

  const totals = useMemo(
    () => (shown ? summaryTotals(shown.summary) : null),
    [shown]
  )
  const years = useMemo(
    () => yearsForChooser(earliestActivityTime, timeZone, today),
    [earliestActivityTime, timeZone, today]
  )

  const annualRef = useRef<AnnualCalendarHandle>(null)
  const monthRef = useRef<MonthCalendarHandle>(null)
  const calendarRegion = useRef<HTMLDivElement>(null)

  const focusDay = useCallback(
    (date: DateKey) => {
      if (gridView === 'annual') annualRef.current?.focusDate(date)
      else if (showList) {
        calendarRegion.current
          ?.querySelector<HTMLElement>(`[data-date="${date}"]`)
          ?.focus()
      } else monthRef.current?.focusDate(date)
    },
    [gridView, showList]
  )

  const selectDay = useCallback(
    (date: DateKey) => dispatch({ type: 'SELECT_DAY', date }),
    []
  )
  const openMonth = useCallback(
    (year: number, month: number) =>
      dispatch({ type: 'OPEN_MONTH', year, month }),
    []
  )

  // Close and Escape put focus back on the day's cell.
  const closeDetails = useCallback(() => {
    if (selectedDate === null) return
    dispatch({ type: 'CLEAR_DAY' })
    focusDay(selectedDate)
  }, [focusDay, selectedDate])

  const onCalendarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (selectedDate === null) return
    event.preventDefault()
    closeDetails()
  }

  // Mobile sheet: pad the page's scroll by the sheet's height so the selected
  // cell (and the end of the page) can always sit above it.
  const sheetOpen = compact && selectedDate !== null
  const [sheetHeight, setSheetHeight] = useState(0)
  const onSheetHeight = useCallback(
    (height: number) => setSheetHeight(Math.round(height)),
    []
  )
  useEffect(() => {
    if (!sheetOpen || sheetHeight <= 0) return
    const html = document.documentElement
    const previous = html.style.scrollPaddingBottom
    html.style.scrollPaddingBottom = `${sheetHeight + 16}px`
    calendarRegion.current
      ?.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`)
      ?.scrollIntoView?.({ block: 'nearest', behavior: scrollBehavior() })
    return () => {
      html.style.scrollPaddingBottom = previous
    }
  }, [sheetOpen, sheetHeight, selectedDate])

  const calendarHeadingId = useId()
  const isEmpty = status === 'success' && totals !== null && totals.count === 0

  const legend = (
    <CalendarLegend
      metric={metric}
      showUpcoming={gridView === 'month' && gridRange.kind === 'this_month'}
    />
  )
  const monthParts = dateKeyParts(gridRange.from)
  const monthFooter = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-muted-foreground text-[13px]">
        <span className="text-foreground font-semibold">
          {formatMonthShort(monthParts.month)} {monthParts.year}
        </span>{' '}
        · {loading ? 'Loading activity…' : monthCaption(gridRange, today)}
      </p>
      {legend}
    </div>
  )

  const detailsProps = {
    date: selectedDate ?? today,
    timeZone,
    totals: selectedTotals,
    activities: dayActivities.activities,
    loading: dayActivities.loading,
    loadingMore: dayActivities.loadingMore,
    error: dayActivities.error,
    hasMore: dayActivities.hasMore,
    onRetry: dayActivities.retry,
    onLoadMore: dayActivities.loadMore,
    onClose: closeDetails
  }

  return (
    <div
      ref={rootRef}
      data-testid="fitness-overview"
      className="@container/fitness space-y-6"
    >
      <FitnessOverviewHeader
        applied={applied}
        canStep={{
          previous: getStepTarget(state, 'previous') !== null,
          next: getStepTarget(state, 'next') !== null
        }}
        loading={loading}
        onStep={(direction) => dispatch({ type: 'STEP', direction })}
        onOpenLatestMonth={() => dispatch({ type: 'OPEN_LATEST_MONTH' })}
        onBackToYear={() => dispatch({ type: 'BACK_TO_YEAR' })}
        rangePicker={
          <RangePicker
            applied={applied}
            today={today}
            draft={state.picker}
            years={years}
            compact={compact}
            className="h-11 pointer-coarse:h-11"
            onOpen={() => dispatch({ type: 'OPEN_PICKER' })}
            onChoosePreset={(preset) =>
              dispatch({ type: 'CHOOSE_PRESET', preset })
            }
            onEditDraft={(field, text) =>
              dispatch({ type: 'EDIT_DRAFT', field, text })
            }
            onCancel={() => dispatch({ type: 'CANCEL_PICKER' })}
            onApply={() => dispatch({ type: 'APPLY_PICKER' })}
            onSelectYear={(year) => dispatch({ type: 'APPLY_YEAR', year })}
          />
        }
      />

      {status === 'error' && (
        <div
          role="alert"
          className="border-l-destructive flex flex-wrap items-center gap-3 rounded-lg border border-l-4 p-4"
        >
          <AlertTriangle
            className="text-destructive-text size-5 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-[1_1_16rem] text-sm">
            <p className="font-semibold">
              {showingPrevious && result
                ? `Showing previous results for ${formatRange(result.range.from, result.range.to)}`
                : `We couldn’t load ${formatRange(applied.from, applied.to)}`}
            </p>
            <p className="text-muted-foreground break-words">
              {showingPrevious
                ? `We couldn’t load ${formatRange(applied.from, applied.to)}. Totals and calendar below are from the previous range.`
                : 'Nothing is shown for this range until it loads.'}{' '}
              {data.error}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={data.retry}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      <FitnessSummaryStrip
        totals={totals}
        loading={loading}
        className={cn(
          'bg-border overflow-hidden rounded-lg border transition-opacity duration-150',
          loading && 'opacity-60'
        )}
      />

      <section aria-labelledby={calendarHeadingId} className="space-y-4">
        <h2 id={calendarHeadingId} className="text-base font-semibold">
          Training calendar
        </h2>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <MetricSelector
              value={metric}
              onChange={(next) =>
                dispatch({ type: 'SET_METRIC', metric: next })
              }
            />
            {view === 'month' && listAvailable && (
              <div
                role="group"
                aria-label="Show the month as"
                className="border-border flex h-11 items-stretch gap-0.5 rounded-lg border p-1"
              >
                {(['grid', 'list'] as const).map((layout) => (
                  <button
                    key={layout}
                    type="button"
                    aria-pressed={monthLayout === layout}
                    onClick={() => setMonthLayout(layout)}
                    className={cn(
                      'focus-visible:ring-ring/50 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px]',
                      monthLayout === layout
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {layout === 'grid' ? 'Grid' : 'List'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* A failed first read keeps the grid's shape but carries no data, so
            it is inert: nothing to select, nothing announced as a rest day.
            No margin above the annual grid: its month-label band already
            carries 27px. */}
          <div
            ref={calendarRegion}
            className={gridView === 'annual' ? undefined : 'mt-4'}
            onKeyDown={onCalendarKeyDown}
            inert={unavailable || undefined}
            aria-hidden={unavailable || undefined}
          >
            {gridView === 'annual' ? (
              <AnnualCalendar
                ref={annualRef}
                range={gridRange}
                today={today}
                days={gridDays}
                metric={metric}
                selectedDate={selectedDate}
                loading={loading || unavailable}
                legend={legend}
                onSelectDate={selectDay}
                onOpenMonth={openMonth}
              />
            ) : showList ? (
              <>
                <MonthDayList
                  year={monthParts.year}
                  month={monthParts.month}
                  today={today}
                  range={gridRange}
                  days={gridDays}
                  metric={metric}
                  selectedDate={selectedDate}
                  loading={loading || unavailable}
                  onSelectDate={selectDay}
                />
                {monthFooter}
              </>
            ) : (
              <MonthCalendar
                ref={monthRef}
                year={monthParts.year}
                month={monthParts.month}
                today={today}
                range={gridRange}
                days={gridDays}
                metric={metric}
                selectedDate={selectedDate}
                loading={loading || unavailable}
                onSelectDate={selectDay}
              >
                {monthFooter}
              </MonthCalendar>
            )}
          </div>
        </div>
        <p role="status" className="sr-only">
          {loading ? `Loading ${formatRange(applied.from, applied.to)}` : ''}
        </p>

        {selectedDate !== null && !compact && <DayDetails {...detailsProps} />}
      </section>

      {isEmpty ? (
        <div className="bg-muted/40 flex items-start gap-3 rounded-lg border p-4">
          <span
            aria-hidden="true"
            className="bg-background flex size-10 shrink-0 items-center justify-center rounded-lg border"
          >
            <CalendarDays className="text-muted-foreground size-5" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              No activities recorded in {formatRange(applied.from, applied.to)}.
            </p>
            <p className="text-muted-foreground">
              Try another date range, or{' '}
              <Link
                href="/fitness/files"
                prefetch={false}
                className="text-primary-text hover:underline"
              >
                upload an activity file
              </Link>
              .
            </p>
          </div>
        </div>
      ) : unavailable ? null : (
        <ActivityTypeBreakdown
          summary={shown?.summary ?? []}
          selectedActivityType={selectedActivityType}
          loading={loading}
        />
      )}

      {sheetOpen && (
        <>
          {/* Room under the last section so the page can scroll it above the
              sheet. */}
          <div aria-hidden="true" style={{ height: sheetHeight }} />
          <DayDetailsSheet {...detailsProps} onHeightChange={onSheetHeight} />
        </>
      )}
    </div>
  )
}
