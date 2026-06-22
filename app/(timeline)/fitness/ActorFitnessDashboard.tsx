'use client'

import {
  Activity,
  ArrowDownWideNarrow,
  CalendarDays,
  Clock,
  Mountain,
  Route
} from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

interface Props {
  actorId: string
  currentTime: number
}

type PresetKey = '1y' | '2y' | '5y' | '10y' | 'custom'

const PRESETS: Array<{ key: PresetKey; label: string; days: number }> = [
  { key: '1y', label: '1Y', days: 365 },
  { key: '2y', label: '2Y', days: 730 },
  { key: '5y', label: '5Y', days: 1825 },
  { key: '10y', label: '10Y', days: 3650 }
]

const DEFAULT_PRESET_DAYS = 365

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

const formatActivityType = (type: string): string =>
  type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

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

export const ActorFitnessDashboard: FC<Props> = ({ actorId, currentTime }) => {
  const [preset, setPreset] = useState<PresetKey>('1y')
  const [startDate, setStartDate] = useState(() =>
    formatDateInput(currentTime - DEFAULT_PRESET_DAYS * DAY_MS)
  )
  const [endDate, setEndDate] = useState(() => formatDateInput(currentTime))

  // After hydration, align the default range with the user's local calendar:
  // the SSR-deterministic UTC defaults above can be a day off for non-UTC
  // users, which would silently exclude today's activities.
  useEffect(() => {
    const now = Date.now()
    setStartDate(
      formatLocalDateInput(new Date(now - DEFAULT_PRESET_DAYS * DAY_MS))
    )
    setEndDate(formatLocalDateInput(new Date(now)))
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
    // snapshot, so a long-lived page still gets a range ending today.
    const now = Date.now()
    setStartDate(formatLocalDateInput(new Date(now - presetDef.days * DAY_MS)))
    setEndDate(formatLocalDateInput(new Date(now)))
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
                <ArrowDownWideNarrow className="size-4" />
                Activity Mix
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Activity</th>
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2 text-right">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {topActivities.map((item) => (
                    <tr key={item.activityType} className="border-b">
                      <td className="px-3 py-2">
                        {formatActivityType(item.activityType)}
                      </td>
                      <td className="px-3 py-2 text-right">{item.count}</td>
                      <td className="px-3 py-2 text-right">
                        {formatDistance(item.totalDistanceMeters)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </div>
      )}
    </div>
  )
}
