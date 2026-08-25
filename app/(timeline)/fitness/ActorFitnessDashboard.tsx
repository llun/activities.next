'use client'

import {
  Activity,
  BarChart3,
  CalendarDays,
  Clock,
  Mountain,
  Route
} from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useMemo, useState } from 'react'

import {
  FitnessActivitySummary,
  FitnessCalendarDay,
  getFitnessCalendarData,
  getFitnessSummary
} from '@/lib/client'
import {
  CalendarMetric,
  FitnessCalendarHeatmap
} from '@/lib/components/fitness/FitnessCalendarHeatmap'
import { Card } from '@/lib/components/ui/card'
import {
  formatActivityTypeLabel,
  getActivityPresentation
} from '@/lib/services/fitness-files/activityPresentation'
import { cn } from '@/lib/utils'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { getActivityFilterHref } from './activityFilter'

interface Props {
  actorId: string
  currentTime: number
  /**
   * The stored `activityType` the recent-activities feed below is filtered to,
   * straight off the page's `?activity=` search param. Owned by the URL rather
   * than by this component so the server render that filters the feed and the
   * row that reads as selected can never disagree.
   */
  selectedActivityType?: string
}

type PresetKey = 'ytd' | '1y' | '5y' | '10y' | 'custom'

const PRESETS: Array<{ key: PresetKey; label: string; days?: number }> = [
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y', days: 365 },
  { key: '5y', label: '5Y', days: 1825 },
  { key: '10y', label: '10Y', days: 3650 }
]

// Single source of truth for the initial range: the active preset pill and the
// seeded date window both derive from this key, so changing the default can't
// silently desync the highlighted preset from the computed dates.
const DEFAULT_PRESET_KEY: PresetKey = 'ytd'

const CALENDAR_METRICS: Array<[CalendarMetric, string]> = [
  ['count', 'Count'],
  ['distance', 'Distance'],
  ['duration', 'Duration']
]

const DAY_MS = 24 * 60 * 60 * 1000

const MIN_DATE_RANGE_MS = 7 * DAY_MS

// UTC formatting keeps the server render and the client hydration identical
// regardless of the local timezone; it can differ from the user's local
// calendar by one day, so post-hydration code uses the local variant below.
const formatDateInput = (value: number | Date): string =>
  getISOTimeUTC(value, true)

// Local-calendar formatter — only safe after hydration (mount effects and
// event handlers), where server/client output no longer has to match.
const formatLocalDateInput = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getPresetRange = (
  key: PresetKey,
  currentTime: number,
  mode: 'utc' | 'local'
): { start: string; end: string } => {
  if (key === 'ytd') {
    if (mode === 'utc') {
      const year = new Date(currentTime).getUTCFullYear()
      return { start: `${year}-01-01`, end: `${year}-12-31` }
    }
    const year = new Date(currentTime).getFullYear()
    return {
      start: formatLocalDateInput(new Date(year, 0, 1)),
      end: formatLocalDateInput(new Date(year, 11, 31))
    }
  }

  const presetDef = PRESETS.find((item) => item.key === key)
  const days = presetDef?.days ?? 365

  if (mode === 'utc') {
    return {
      start: formatDateInput(currentTime - days * DAY_MS),
      end: formatDateInput(currentTime)
    }
  }

  return {
    start: formatLocalDateInput(new Date(currentTime - days * DAY_MS)),
    end: formatLocalDateInput(new Date(currentTime))
  }
}

const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

const getTotals = (summary: FitnessActivitySummary[]) =>
  summary.reduce(
    (acc, item) => {
      acc.count += item.count
      acc.totalDistanceMeters += item.totalDistanceMeters
      acc.totalDurationSeconds += item.totalDurationSeconds
      acc.totalElevationGainMeters += item.totalElevationGainMeters
      return acc
    },
    {
      count: 0,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      totalElevationGainMeters: 0
    }
  )

export const ActorFitnessDashboard: FC<Props> = ({
  actorId,
  currentTime,
  selectedActivityType
}) => {
  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET_KEY)
  const [startDate, setStartDate] = useState(
    () => getPresetRange(DEFAULT_PRESET_KEY, currentTime, 'utc').start
  )
  const [endDate, setEndDate] = useState(
    () => getPresetRange(DEFAULT_PRESET_KEY, currentTime, 'utc').end
  )

  // After hydration, align the default range with the user's local calendar:
  // the SSR-deterministic UTC defaults above can be a day off for non-UTC
  // users, which would silently exclude today's activities.
  useEffect(() => {
    const range = getPresetRange(DEFAULT_PRESET_KEY, Date.now(), 'local')
    setStartDate(range.start)
    setEndDate(range.end)
  }, [])
  const [summary, setSummary] = useState<FitnessActivitySummary[]>([])
  const [calendarDays, setCalendarDays] = useState<FitnessCalendarDay[]>([])
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('count')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).getTime()
  const endMsExclusive = endMs + 24 * 60 * 60 * 1000
  const isInverted = endMs < startMs
  const isRangeValid =
    !isInverted && endMsExclusive - startMs >= MIN_DATE_RANGE_MS

  useEffect(() => {
    if (!isRangeValid) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    Promise.all([
      getFitnessSummary({
        actorId,
        startDate: startMs,
        endDate: endMsExclusive
      }),
      getFitnessCalendarData({
        actorId,
        startDate: startMs,
        endDate: endMsExclusive
      })
    ])
      .then(([summaryData, calendarData]) => {
        if (cancelled) return
        setSummary(summaryData)
        setCalendarDays(calendarData)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load fitness overview.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [actorId, startDate, endDate, isRangeValid, startMs, endMsExclusive])

  const totals = useMemo(() => getTotals(summary), [summary])
  const topActivities = useMemo(
    () =>
      [...summary].sort(
        (first, second) =>
          second.totalDistanceMeters - first.totalDistanceMeters ||
          second.count - first.count
      ),
    [summary]
  )

  const applyPreset = (newPreset: PresetKey) => {
    const presetDef = PRESETS.find((item) => item.key === newPreset)
    if (!presetDef) return
    setPreset(newPreset)
    // Event handler: use the actual current time, not the server-render
    // snapshot, so a long-lived page still gets a range aligned to now.
    const range = getPresetRange(newPreset, Date.now(), 'local')
    setStartDate(range.start)
    setEndDate(range.end)
  }

  return (
    // Container-query context: the fitness page renders inside the sidebar
    // layout, so the viewport width is a poor proxy for how much room the
    // content column actually has. Sizing the cards/calendar against the
    // container (not the viewport) keeps a narrow desktop column from cramming
    // four big-number cards side by side — the tablet/mobile complaint.
    <div className="@container/fitness space-y-5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded border p-0.5">
          {PRESETS.map((item) => (
            <button
              key={item.key}
              onClick={() => applyPreset(item.key)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                preset === item.key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span className="rounded bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
              Custom
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <input
            type="date"
            value={startDate}
            onChange={(event) => {
              setPreset('custom')
              setStartDate(event.target.value)
            }}
            className="rounded border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <input
            type="date"
            value={endDate}
            onChange={(event) => {
              setPreset('custom')
              setEndDate(event.target.value)
            }}
            className="rounded border bg-background px-2 py-1 text-sm"
          />
        </label>
      </div>

      {isInverted && (
        <p className="text-sm text-destructive">
          End date must be after start date
        </p>
      )}
      {!isInverted && !isRangeValid && (
        <p className="text-sm text-destructive">
          Date range must be at least 7 days
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-2 @2xl/fitness:grid-cols-4">
        <Card className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="size-3.5" />
            Activities
          </div>
          <div className="whitespace-nowrap text-xl font-semibold tabular-nums @3xl/fitness:text-2xl">
            {totals.count}
          </div>
        </Card>
        <Card className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Route className="size-3.5" />
            Distance
          </div>
          <div className="whitespace-nowrap text-xl font-semibold tabular-nums @3xl/fitness:text-2xl">
            {formatDistance(totals.totalDistanceMeters)}
          </div>
        </Card>
        <Card className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            Duration
          </div>
          <div className="whitespace-nowrap text-xl font-semibold tabular-nums @3xl/fitness:text-2xl">
            {formatDuration(totals.totalDurationSeconds)}
          </div>
        </Card>
        <Card className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mountain className="size-3.5" />
            Elevation
          </div>
          <div className="whitespace-nowrap text-xl font-semibold tabular-nums @3xl/fitness:text-2xl">
            {Math.round(totals.totalElevationGainMeters)} m
          </div>
        </Card>
      </div>

      {isRangeValid && isLoading && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </p>
      )}

      {isRangeValid && !isLoading && !error && summary.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No fitness activities in this period
        </p>
      )}

      {isRangeValid && !isLoading && !error && summary.length > 0 && (
        <div className="grid grid-cols-1 gap-5 @3xl/fitness:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 text-base font-medium">
                  <CalendarDays className="size-4" />
                  Training Calendar
                </h2>
                <div className="flex gap-1 rounded border p-0.5">
                  {CALENDAR_METRICS.map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setCalendarMetric(key)}
                      className={cn(
                        'rounded px-2 py-1 text-xs transition-colors',
                        calendarMetric === key
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <FitnessCalendarHeatmap
                key={actorId}
                days={calendarDays}
                metric={calendarMetric}
                periodType="all_time"
                periodKey="all"
                startDate={startMs}
                endDate={endMsExclusive - 1}
              />
            </Card>
          </section>

          <section>
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="inline-flex items-center gap-2 text-base font-medium">
                <BarChart3 className="size-4" />
                Activities
              </h2>
              {/* The card can sit in a 360px column beside the calendar, and a
                  free-form activity type is stored verbatim — so the numbers
                  keep their own width (`whitespace-nowrap`) and only the name
                  wraps, with the whole table free to scroll rather than push
                  the card wider than its grid track.

                  `break-words` on that name, NOT the `wrap-anywhere` the gear
                  tables use: this table auto-sizes rather than snapping, and
                  breaking anywhere drops the name column's min-content
                  contribution to one character, which is what let table layout
                  squeeze "Walk" into "Wal / k" on a phone. Keeping whole words
                  as the floor makes the column overflow into the scroller above
                  instead. */}
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">
                        Activity
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right font-medium"
                      >
                        Count
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right font-medium"
                      >
                        Duration
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right font-medium"
                      >
                        Distance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topActivities.map((item) => {
                      const label = formatActivityTypeLabel(item.activityType)
                      const { emoji } = getActivityPresentation(
                        item.activityType
                      )
                      const isSelected =
                        selectedActivityType === item.activityType
                      return (
                        <tr key={item.activityType} className="border-b">
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span aria-hidden="true" className="shrink-0">
                                {emoji}
                              </span>
                              {/* `prefetch={false}`: one link per activity type
                                  pointing at this same `force-dynamic` page,
                                  so prefetching them would re-run the whole
                                  overview render once per row on screen. */}
                              <Link
                                href={getActivityFilterHref(
                                  item.activityType,
                                  isSelected
                                )}
                                prefetch={false}
                                scroll={false}
                                aria-current={isSelected ? 'true' : undefined}
                                title={
                                  isSelected
                                    ? 'Clear filter'
                                    : `Show recent ${label} activities`
                                }
                                className={cn(
                                  'break-words font-medium text-primary-text hover:underline',
                                  isSelected && 'underline'
                                )}
                              >
                                {label}
                              </Link>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {item.count}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {formatDuration(item.totalDurationSeconds)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {formatDistance(item.totalDistanceMeters)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        </div>
      )}
    </div>
  )
}
