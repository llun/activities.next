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
import { cn } from '@/lib/utils'

interface Props {
  actorId: string
}

type PresetKey = '30d' | '90d' | 'year' | 'all'

const PRESETS: Array<{ key: PresetKey; label: string; days: number }> = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'year', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: 3650 }
]

const MIN_DATE_RANGE_MS = 7 * 24 * 60 * 60 * 1000

const formatDateInput = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getPresetStartDate = (days: number) => {
  const now = new Date()
  return formatDateInput(new Date(now.getTime() - days * 24 * 60 * 60 * 1000))
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

export const ActorFitnessDashboard: FC<Props> = ({ actorId }) => {
  const [preset, setPreset] = useState<PresetKey>('90d')
  const [startDate, setStartDate] = useState(() => getPresetStartDate(90))
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
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
    setStartDate(getPresetStartDate(presetDef.days))
    setEndDate(formatDateInput(new Date()))
  }

  return (
    <div className="space-y-5 p-3 sm:p-4">
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
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <input
            type="date"
            value={startDate}
            onChange={(event) => {
              setPreset('all')
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
              setPreset('all')
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

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="size-3.5" />
            Activities
          </div>
          <div className="mt-2 text-2xl font-semibold">{totals.count}</div>
        </div>
        <div className="rounded border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Route className="size-3.5" />
            Distance
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {formatDistance(totals.totalDistanceMeters)}
          </div>
        </div>
        <div className="rounded border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            Duration
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {formatDuration(totals.totalDurationSeconds)}
          </div>
        </div>
        <div className="rounded border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mountain className="size-3.5" />
            Elevation
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {Math.round(totals.totalElevationGainMeters)} m
          </div>
        </div>
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
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 text-base font-medium">
                <CalendarDays className="size-4" />
                Training Calendar
              </h2>
              <div className="flex gap-1 rounded border p-0.5">
                {(
                  [
                    ['count', 'Count'],
                    ['distance', 'Distance'],
                    ['duration', 'Duration']
                  ] as [CalendarMetric, string][]
                ).map(([key, label]) => (
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
              days={calendarDays}
              metric={calendarMetric}
              periodType="all_time"
              periodKey="all"
            />
          </section>

          <section className="space-y-3">
            <h2 className="inline-flex items-center gap-2 text-base font-medium">
              <ArrowDownWideNarrow className="size-4" />
              Activity Mix
            </h2>
            <div className="overflow-hidden rounded border">
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
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
