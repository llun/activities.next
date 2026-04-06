'use client'

import { FC, useCallback, useEffect, useMemo, useState } from 'react'

import {
  FitnessCalendarDay,
  FitnessHeatmapData,
  getDistinctFitnessActivityTypes,
  getFitnessCalendarData,
  getFitnessHeatmap
} from '@/lib/client'
import {
  CalendarMetric,
  FitnessCalendarHeatmap
} from '@/lib/components/fitness/FitnessCalendarHeatmap'

type PeriodType = 'all_time' | 'yearly' | 'monthly'

interface Props {
  actorId: string
}

const METRIC_LABELS: Record<CalendarMetric, string> = {
  count: 'Count',
  distance: 'Distance',
  duration: 'Duration'
}

const currentYear = new Date().getUTCFullYear()

const getCalendarDateRange = (
  periodType: PeriodType,
  periodKey: string
): { startDate: number; endDate: number } => {
  if (periodType === 'yearly') {
    const year = parseInt(periodKey, 10)
    return {
      startDate: Date.UTC(year, 0, 1),
      endDate: Date.UTC(year + 1, 0, 1)
    }
  }

  if (periodType === 'monthly') {
    const [yearStr, monthStr] = periodKey.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1
    return {
      startDate: Date.UTC(year, month, 1),
      endDate: Date.UTC(year, month + 1, 1)
    }
  }

  // all_time: last 12 months
  const now = new Date()
  const start = Date.UTC(
    now.getUTCFullYear() - 1,
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return { startDate: start, endDate: now.getTime() }
}

const generateYearOptions = (): number[] => {
  const years: number[] = []
  for (let y = currentYear; y >= currentYear - 10; y--) {
    years.push(y)
  }
  return years
}

const generateMonthOptions = (year: number): string[] => {
  const months: string[] = []
  const now = new Date()
  const maxMonth = year === now.getUTCFullYear() ? now.getUTCMonth() : 11
  for (let m = maxMonth; m >= 0; m--) {
    months.push(`${year}-${String(m + 1).padStart(2, '0')}`)
  }
  return months
}

export const FitnessHeatmapView: FC<Props> = ({ actorId }) => {
  const [activityTypes, setActivityTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string>('')
  const [periodType, setPeriodType] = useState<PeriodType>('all_time')
  const [periodKey, setPeriodKey] = useState<string>('all')
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('count')

  const [heatmapData, setHeatmapData] = useState<FitnessHeatmapData | null>(
    null
  )
  const [calendarDays, setCalendarDays] = useState<FitnessCalendarDay[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDistinctFitnessActivityTypes({ actorId })
      .then(setActivityTypes)
      .catch(() => {
        // Activity types are non-critical, just use empty list
      })
  }, [actorId])

  const effectivePeriodKey = useMemo(() => {
    if (periodType === 'all_time') return 'all'
    if (periodType === 'yearly') return `${selectedYear}`
    return periodKey
  }, [periodType, selectedYear, periodKey])

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const activityType = selectedType || undefined
      const { startDate, endDate } = getCalendarDateRange(
        periodType,
        effectivePeriodKey
      )

      const [heatmap, calendar] = await Promise.all([
        getFitnessHeatmap({
          actorId,
          activityType,
          periodType,
          periodKey: effectivePeriodKey
        }),
        getFitnessCalendarData({
          actorId,
          startDate,
          endDate,
          activityType
        })
      ])

      setHeatmapData(heatmap)
      setCalendarDays(calendar)
    } catch {
      setError('Failed to load heatmap data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [actorId, selectedType, periodType, effectivePeriodKey])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const yearOptions = useMemo(() => generateYearOptions(), [])
  const monthOptions = useMemo(
    () => generateMonthOptions(selectedYear),
    [selectedYear]
  )

  const handlePeriodTypeChange = (newType: PeriodType) => {
    setPeriodType(newType)
    if (newType === 'all_time') {
      setPeriodKey('all')
    } else if (newType === 'yearly') {
      setPeriodKey(`${selectedYear}`)
    } else {
      const month = String(new Date().getUTCMonth() + 1).padStart(2, '0')
      setPeriodKey(`${selectedYear}-${month}`)
    }
  }

  const handleYearChange = (year: number) => {
    setSelectedYear(year)
    if (periodType === 'yearly') {
      setPeriodKey(`${year}`)
    } else if (periodType === 'monthly') {
      const month = String(new Date().getUTCMonth() + 1).padStart(2, '0')
      setPeriodKey(`${year}-${month}`)
    }
  }

  return (
    <div className="space-y-6 p-2 sm:p-4">
      {/* Selectors */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Activity
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded border bg-background px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {activityTypes.map((type) => (
              <option key={type} value={type}>
                {type
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Period
          <select
            value={periodType}
            onChange={(e) =>
              handlePeriodTypeChange(e.target.value as PeriodType)
            }
            className="rounded border bg-background px-2 py-1 text-sm"
          >
            <option value="all_time">All Time</option>
            <option value="yearly">Yearly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        {periodType !== 'all_time' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Year
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              className="rounded border bg-background px-2 py-1 text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}

        {periodType === 'monthly' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Month
            <select
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-sm"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {isLoading && (
        <p className="text-center text-muted-foreground">Loading...</p>
      )}

      {error && (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!isLoading && (
        <>
          {/* Geographic Heatmap */}
          <div className="space-y-2">
            <h2 className="text-lg font-medium">Route Heatmap</h2>
            {!heatmapData && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No heatmap generated yet. Run the generation script or wait for
                new activities to be processed.
              </p>
            )}
            {heatmapData && heatmapData.status === 'generating' && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Heatmap is being generated...
              </p>
            )}
            {heatmapData && heatmapData.status === 'failed' && (
              <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
                Heatmap generation failed. Try regenerating.
              </p>
            )}
            {heatmapData &&
              heatmapData.status === 'completed' &&
              heatmapData.imagePath && (
                <div className="overflow-hidden rounded-lg border">
                  <img
                    src={`/api/v1/fitness-files/heatmap-image/${heatmapData.id}`}
                    alt={`Route heatmap for ${selectedType || 'all activities'}`}
                    className="h-auto w-full"
                  />
                  <div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {heatmapData.activityCount}{' '}
                    {heatmapData.activityCount === 1
                      ? 'activity'
                      : 'activities'}{' '}
                    included
                  </div>
                </div>
              )}
            {heatmapData &&
              heatmapData.status === 'completed' &&
              !heatmapData.imagePath && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No route data available for this period.
                </p>
              )}
          </div>

          {/* Calendar Heatmap */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Activity Calendar</h2>
              <div className="flex gap-1 rounded-md border p-0.5">
                {(
                  Object.entries(METRIC_LABELS) as [CalendarMetric, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setCalendarMetric(key)}
                    className={`rounded-sm px-2 py-1 text-xs transition-colors ${
                      calendarMetric === key
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <FitnessCalendarHeatmap
              days={calendarDays}
              metric={calendarMetric}
              periodType={periodType}
              periodKey={effectivePeriodKey}
            />
          </div>
        </>
      )}
    </div>
  )
}
