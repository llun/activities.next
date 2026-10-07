'use client'

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw
} from 'lucide-react'
import Link from 'next/link'
import {
  CSSProperties,
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'

import { FitnessAlert } from '@/lib/components/fitness/FitnessAlert'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { FITNESS_STAT_STRIP_CLASS } from '@/lib/components/fitness/FitnessStatCell'
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
import {
  indexDays,
  scrollBehavior
} from '@/lib/components/fitness/calendar/calendarShared'
import { useElementWidth } from '@/lib/components/fitness/calendar/useElementWidth'
import { RefreshButton } from '@/lib/components/refresh-button'
import { Button } from '@/lib/components/ui/button'
import {
  formatMonthShort,
  formatMonthYear,
  formatRange
} from '@/lib/fitness/calendar/format'
import {
  MONTH_CELL_GAP,
  MONTH_CELL_MAX,
  MONTH_COLUMNS,
  monthNeedsListAlternative
} from '@/lib/fitness/calendar/geometry'
import {
  DateKey,
  dateKeyParts,
  localDateKeyAt
} from '@/lib/fitness/calendar/localDay'
import {
  OverviewAction,
  createOverviewState,
  overviewReducer
} from '@/lib/fitness/calendar/overviewState'
import {
  AppliedRange,
  StepDirection,
  latestMonthIn,
  rangeContains,
  rangesEqual,
  stepTarget,
  viewFor,
  yearsForChooser
} from '@/lib/fitness/calendar/ranges'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { cn } from '@/lib/utils'

import { ActivityTypeBreakdown } from './ActivityTypeBreakdown'
import {
  CalendarYearMenu,
  FitnessOverviewHeader,
  InOverviewHeaderSlot,
  OverviewDates,
  StepButtons,
  calendarYearOf,
  stepsApply
} from './FitnessOverviewHeader'
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
      {/* The compact header's shape: its 48px title and dates, then the
          44px picker row. From a column of INLINE_DETAILS_MIN_WIDTH (600px,
          in px as the overview measures it) the overview moves both into the
          page header, so nothing is drawn here. Fixed heights, not margins,
          so the strip below stays put when the overview replaces this. */}
      <div aria-hidden="true" className="space-y-3 @min-[600px]:hidden">
        <div className="h-12 space-y-1.5 pt-1">
          <span className="block h-5 w-44 rounded skeleton" />
          <span className="block h-4 w-32 rounded skeleton" />
        </div>
        <div className="flex justify-end gap-2">
          <span className="block h-11 w-56 rounded-md skeleton" />
          <span className="block size-11 rounded-md skeleton" />
        </div>
      </div>
      <FitnessSummaryStrip
        totals={null}
        loading
        className="bg-border overflow-hidden rounded-lg border"
      />
      <div aria-hidden="true" className="space-y-4">
        <span className="block h-5 w-36 rounded skeleton" />
        <span className="block h-11 w-full max-w-80 rounded-lg skeleton" />
        <span className="block h-40 w-full rounded-lg skeleton" />
      </div>
    </div>
  )
}

type MonthLayout = 'grid' | 'list'

/** The month grid's own width: seven cells and six gaps (geometry.ts). */
const MONTH_GRID_WIDTH = `calc(min(${MONTH_CELL_MAX}px, (100cqw - ${(MONTH_COLUMNS - 1) * MONTH_CELL_GAP}px) / ${MONTH_COLUMNS}) * ${MONTH_COLUMNS} + ${(MONTH_COLUMNS - 1) * MONTH_CELL_GAP}px)`

const TEXT_ACTION =
  'text-primary-text focus-visible:ring-ring/50 inline-flex h-11 items-center gap-1 rounded-md px-1 text-sm font-medium outline-none hover:underline focus-visible:ring-[3px]'

const INSTANT_COLOUR_STYLE = { '--fitness-t-color': '0ms' } as CSSProperties

/** Runs `callback` once the next frame has painted; returns a canceller. */
const afterNextPaint = (callback: () => void) => {
  if (typeof requestAnimationFrame !== 'function') {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  }
  let inner = 0
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(callback)
  })
  return () => {
    cancelAnimationFrame(outer)
    cancelAnimationFrame(inner)
  }
}

/** Room kept above a pinned cell for the page's sticky header. */
const STICKY_HEADER_ROOM = 64

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
  const { applied, today, metric } = state

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
  // The range everything visible describes: the heading, the dates, the
  // picker's label, the toolbar, the grid and the totals. It is the applied
  // range, except after a failed read that kept the previous results, when it
  // is that previous range (the banner names both). A deliberate departure
  // from architecture §2.4, so nothing on screen contradicts the data.
  const displayRange = shown?.range ?? applied
  const gridView = viewFor(displayRange)
  // A day picked on the previous results (see SELECT_DAY's `within`) lies
  // outside `applied`. It belongs to what is on screen, so it is shown there
  // and nowhere else: not while the applied range loads, and not after it has.
  //
  // The day's totals come from the committed read's buckets, so a day is shown
  // only once a committed result covers it: a day picked while the first read
  // is pending (or after it failed), or one outside the previous range during
  // a new range's load, would otherwise read "0 activities" above rows that
  // exist. The pick is kept and appears when the read lands.
  const selectedDate =
    state.selectedDate !== null &&
    result !== null &&
    rangeContains(result.range, state.selectedDate) &&
    rangeContains(displayRange, state.selectedDate)
      ? state.selectedDate
      : null
  const gridDays = shown?.days ?? NO_DAYS
  const showList =
    gridView === 'month' && listAvailable && monthLayout === 'list'

  // Steps, Month view and the year chooser move from what is on screen.
  const canStep = {
    previous: stepTarget(displayRange, 'previous', today) !== null,
    next: stepTarget(displayRange, 'next', today) !== null
  }
  // After a failed read the range on screen is the previous one, so a step,
  // Month view, a month label, the year chooser or the picker can target the
  // range that just failed, which is still the applied one. Applying it again
  // changes nothing the read depends on, so read it again instead. Every
  // control that applies a range goes through here. It reads the state,
  // status and retry of the latest commit from a ref, so it keeps one identity
  // for the component's life: the memoized year rows that get `openMonth` are
  // not redrawn for a picker edit, a day's activities loading or anything else
  // that changes the state. The ref is written in a layout effect, so a click
  // that lands before passive effects run still sees the committed values.
  const { retry } = data
  const latest = useRef({ state, status, retry, displayRange })
  useLayoutEffect(() => {
    latest.current = { state, status, retry, displayRange }
  })
  // The day was picked on a range that is not the applied one; once the applied
  // range has loaded the day no longer belongs to anything on screen.
  useEffect(() => {
    if (
      status === 'success' &&
      state.selectedDate !== null &&
      !rangeContains(applied, state.selectedDate)
    ) {
      dispatch({ type: 'CLEAR_DAY' })
    }
  }, [status, applied, state.selectedDate])
  const applyRange = useCallback((action: OverviewAction) => {
    const { state, status, retry } = latest.current
    dispatch(action)
    if (
      status === 'error' &&
      rangesEqual(overviewReducer(state, action).applied, state.applied)
    ) {
      retry()
    }
  }, [])
  const step = (direction: StepDirection) => {
    const target = stepTarget(displayRange, direction, today)
    if (target) applyRange({ type: 'APPLY_RANGE', range: target })
  }
  const openLatestMonth = () =>
    applyRange({
      type: 'APPLY_RANGE',
      range: latestMonthIn(displayRange, today)
    })
  const backToYear = () => applyRange({ type: 'BACK_TO_YEAR' })

  // The day's totals come from the calendar bucket, from the latest committed
  // read. `selectedDate` is only set for a day that read covers, so a
  // selection kept across a reload shows its totals from the previous read
  // rather than "0 activities" while the new one loads.
  const bucketIndex = useMemo(
    () => indexDays(result?.days ?? NO_DAYS),
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
  const calendarSection = useRef<HTMLElement>(null)

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
    (date: DateKey) =>
      dispatch({
        type: 'SELECT_DAY',
        date,
        within: latest.current.displayRange
      }),
    []
  )
  const openMonth = useCallback(
    (year: number, month: number) =>
      applyRange({ type: 'OPEN_MONTH', year, month }),
    [applyRange]
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

  // Inline details (a container of 600px or more, which includes a phone held
  // sideways) open BELOW the grid, where a short window shows only the grid: a
  // tap would pin a day with nothing to see. Scroll the page just far enough to
  // bring the details into view, but never so far that the pinned cell leaves
  // the top of the window (it stays visible, under the sticky header's room).
  useEffect(() => {
    if (compact || selectedDate === null) return
    return afterNextPaint(() => {
      const section = calendarSection.current
      const cell = calendarRegion.current?.querySelector<HTMLElement>(
        `[data-date="${selectedDate}"]`
      )
      const details = section?.querySelector<HTMLElement>(
        '[data-testid="day-details"], [data-testid="day-details-loading"]'
      )
      if (!cell || !details) return
      const toBring =
        details.getBoundingClientRect().bottom - (window.innerHeight - 16)
      const toKeepCell = cell.getBoundingClientRect().top - STICKY_HEADER_ROOM
      const delta = Math.min(toBring, toKeepCell)
      if (delta > 1) {
        window.scrollBy({ top: delta, behavior: scrollBehavior() })
      }
    })
  }, [compact, selectedDate])

  // Cell colours fade (150ms) only when cells that are already showing data
  // change level, as on a metric switch. A new data set (the first paint, a
  // new range, the end of a reload) appears at once: fading in from the
  // skeleton's grey reads as a flash. The custom property is inherited by every
  // cell; it is restored two frames after the new set has painted.
  const colourKey =
    shown !== null && !loading
      ? `${displayRange.kind}|${displayRange.from}|${displayRange.to}`
      : null
  const [animatedKey, setAnimatedKey] = useState<string | null>(null)
  useEffect(() => {
    if (colourKey === null) return
    return afterNextPaint(() => setAnimatedKey(colourKey))
  }, [colourKey])
  const instantColour = colourKey === null || animatedKey !== colourKey

  // The toolbar's own controls dim while a range loads (the designs' D10, T06
  // and M08) but stay operable: the stale-response guard makes a change
  // mid-load safe, so there is nothing to disable.
  const dimWhileLoading = cn(
    'transition-opacity duration-150',
    loading && 'opacity-60'
  )

  const calendarHeadingId = useId()
  const isEmpty = status === 'success' && totals !== null && totals.count === 0

  // Memoized: the annual calendar hands it to the last year row as
  // `trailing`, and a new element on every render would redraw that row.
  const showUpcoming =
    gridView === 'month' && displayRange.kind === 'this_month'
  const legend = useMemo(
    () => <CalendarLegend metric={metric} showUpcoming={showUpcoming} />,
    [metric, showUpcoming]
  )
  const monthParts = dateKeyParts(displayRange.from)
  const monthFooter = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-muted-foreground text-[13px]">
        <span className="text-foreground font-semibold">
          {formatMonthShort(monthParts.month)} {monthParts.year}
        </span>{' '}
        · {loading ? 'Loading activity…' : monthCaption(displayRange, today)}
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

  const rangePicker = (
    <RangePicker
      applied={displayRange}
      today={today}
      draft={state.picker}
      years={years}
      compact={compact}
      className="h-11 pointer-coarse:h-11"
      onOpen={() => dispatch({ type: 'OPEN_PICKER' })}
      onChoosePreset={(preset) => dispatch({ type: 'CHOOSE_PRESET', preset })}
      onEditDraft={(field, text) =>
        dispatch({ type: 'EDIT_DRAFT', field, text })
      }
      onCancel={() => dispatch({ type: 'CANCEL_PICKER' })}
      onApply={() => applyRange({ type: 'APPLY_PICKER' })}
      onSelectYear={(year) => applyRange({ type: 'APPLY_YEAR', year })}
    />
  )

  // The range picker with the timeline's Refresh at its end: it re-reads the
  // applied range in place, and spins while any read of it is in flight, so
  // the shimmering bars below always have the control that reloads them. An
  // open day's activity list is re-read with it, or its rows would disagree
  // with the day's refreshed totals.
  const refresh = () => {
    data.retry()
    dayActivities.reload()
  }
  const headerControls = (
    <div className="flex items-center gap-2">
      {rangePicker}
      <RefreshButton
        onRefresh={refresh}
        refreshing={loading}
        accessibleName="Refresh fitness overview"
        className="size-11"
      />
    </div>
  )

  // Month view / Back to year: on a phone a text action beside the calendar
  // heading; on wider containers Month view sits in the toolbar and Back to
  // year in the month's own heading row.
  const viewAction =
    gridView === 'annual' ? (
      <button type="button" className={TEXT_ACTION} onClick={openLatestMonth}>
        Month view
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    ) : (
      <button type="button" className={TEXT_ACTION} onClick={backToYear}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to year
      </button>
    )

  return (
    <div
      ref={rootRef}
      data-testid="fitness-overview"
      className="@container/fitness space-y-6"
    >
      {compact ? (
        <FitnessOverviewHeader
          range={displayRange}
          canStep={canStep}
          loading={loading}
          onStep={step}
          rangePicker={headerControls}
        />
      ) : (
        // The page's own "Overview" header carries the dates and the range
        // picker on wide containers. `contents`, so nothing here takes space
        // in this column once they have moved there.
        <div className="contents">
          <InOverviewHeaderSlot slot="dates">
            <OverviewDates range={displayRange} loading={loading} />
          </InOverviewHeaderSlot>
          <InOverviewHeaderSlot slot="range">
            {headerControls}
          </InOverviewHeaderSlot>
        </div>
      )}

      {status === 'error' && (
        <FitnessAlert
          title={
            showingPrevious && result
              ? `Showing previous results for ${formatRange(result.range.from, result.range.to)}`
              : `We couldn’t load ${formatRange(applied.from, applied.to)}`
          }
          action={
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={data.retry}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          }
        >
          {/* Friendly copy only. The reason a read failed is a status line or
              the browser's own words ("Failed to fetch"); neither belongs in
              front of the viewer, and neither says what to do. With nothing
              to fall back on, the title already names the range that failed. */}
          {showingPrevious
            ? `We couldn’t load ${formatRange(applied.from, applied.to)}. Check your connection and try again. Totals and calendar below are from the previous range.`
            : 'Check your connection and try again. Nothing is shown for this range until it loads.'}
        </FitnessAlert>
      )}

      <FitnessSummaryStrip
        totals={totals}
        loading={loading}
        className={cn(
          FITNESS_STAT_STRIP_CLASS,
          'transition-opacity duration-150',
          loading && 'opacity-60'
        )}
      />

      <section
        ref={calendarSection}
        aria-labelledby={calendarHeadingId}
        className="space-y-4"
      >
        <div
          data-testid="training-calendar-toolbar"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        >
          <h2 id={calendarHeadingId} className="text-base font-semibold">
            Training calendar
          </h2>
          {compact ? (
            <div className={dimWhileLoading}>{viewAction}</div>
          ) : (
            gridView === 'annual' && (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-2',
                  dimWhileLoading
                )}
              >
                {/* The year chooser and the year arrows only mean something
                    for ONE calendar year (year to date or a past year). Last
                    12 months and a custom span offer "Month view" alone. */}
                {stepsApply(displayRange) && (
                  <>
                    <CalendarYearMenu
                      years={years}
                      value={calendarYearOf(displayRange)}
                      onSelect={(year) =>
                        applyRange({ type: 'APPLY_YEAR', year })
                      }
                    />
                    <StepButtons
                      view="annual"
                      canStep={canStep}
                      onStep={step}
                    />
                  </>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-1"
                  onClick={openLatestMonth}
                >
                  Month view
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <MetricSelector
              value={metric}
              onChange={(next) =>
                dispatch({ type: 'SET_METRIC', metric: next })
              }
            />
            {gridView === 'month' && listAvailable && (
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

          {!compact && gridView === 'month' && (
            // The month's heading row: Back to year, the month, and the arrows
            // on the grid's right edge (the row is exactly the grid's width).
            <div
              data-testid="month-heading-row"
              className={cn('mt-4 flex items-center gap-3', dimWhileLoading)}
              style={{ maxWidth: MONTH_GRID_WIDTH }}
            >
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-1"
                onClick={backToYear}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Back to year
              </Button>
              <h3 className="min-w-0 truncate text-lg font-semibold">
                {formatMonthYear(monthParts.year, monthParts.month)}
              </h3>
              <StepButtons
                view="month"
                canStep={canStep}
                onStep={step}
                className="ml-auto"
              />
            </div>
          )}

          {/* A failed first read keeps the grid's shape but carries no data, so
            it is inert: nothing to select, nothing announced as a rest day.
            No margin above the annual grid: its month-label band already
            carries 27px. */}
          <div
            ref={calendarRegion}
            data-testid="calendar-region"
            data-instant-colour={instantColour || undefined}
            className={gridView === 'annual' ? undefined : 'mt-4'}
            style={instantColour ? INSTANT_COLOUR_STYLE : undefined}
            onKeyDown={onCalendarKeyDown}
            inert={unavailable || undefined}
            aria-hidden={unavailable || undefined}
          >
            {gridView === 'annual' ? (
              <AnnualCalendar
                ref={annualRef}
                range={displayRange}
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
                  range={displayRange}
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
                range={displayRange}
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
        <FitnessEmptyState
          icon={CalendarDays}
          title={`No activities recorded in ${formatRange(applied.from, applied.to)}.`}
          action={
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => dispatch({ type: 'OPEN_PICKER' })}
            >
              Choose a range
            </Button>
          }
        >
          <p>
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
        </FitnessEmptyState>
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
