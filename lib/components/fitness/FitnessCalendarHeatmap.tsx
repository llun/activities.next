'use client'

import { FC, useMemo } from 'react'

import { FitnessCalendarDay } from '@/lib/client'

export type CalendarMetric = 'count' | 'distance' | 'duration'

interface Props {
  days: FitnessCalendarDay[]
  metric: CalendarMetric
  periodType: 'all_time' | 'yearly' | 'monthly'
  periodKey: string
}

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

const getMetricValue = (day: FitnessCalendarDay, metric: CalendarMetric) => {
  switch (metric) {
    case 'count':
      return day.count
    case 'distance':
      return day.totalDistanceMeters
    case 'duration':
      return day.totalDurationSeconds
  }
}

const getColorClass = (value: number, max: number): string => {
  if (value === 0 || max === 0) return 'bg-muted'
  const ratio = value / max
  if (ratio < 0.25) return 'bg-green-200 dark:bg-green-900'
  if (ratio < 0.5) return 'bg-green-400 dark:bg-green-700'
  if (ratio < 0.75) return 'bg-green-500 dark:bg-green-500'
  return 'bg-green-700 dark:bg-green-400'
}

const formatTooltipValue = (
  day: FitnessCalendarDay,
  metric: CalendarMetric
): string => {
  const date = day.date
  switch (metric) {
    case 'count':
      return `${date}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}`
    case 'distance': {
      const km = (day.totalDistanceMeters / 1000).toFixed(1)
      return `${date}: ${km} km`
    }
    case 'duration': {
      const hours = Math.floor(day.totalDurationSeconds / 3600)
      const minutes = Math.floor((day.totalDurationSeconds % 3600) / 60)
      return hours > 0
        ? `${date}: ${hours}h ${minutes}m`
        : `${date}: ${minutes}m`
    }
  }
}

interface CalendarGrid {
  weeks: Array<Array<{ date: string; day: FitnessCalendarDay | null } | null>>
  monthLabels: Array<{ label: string; weekIndex: number }>
}

const formatDate = (date: Date): string => {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const buildGrid = (
  startDate: Date,
  endDate: Date,
  dayMap: Map<string, FitnessCalendarDay>
): CalendarGrid => {
  const weeks: CalendarGrid['weeks'] = []
  const monthLabels: CalendarGrid['monthLabels'] = []

  const current = new Date(startDate)
  const dayOfWeek = current.getUTCDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  current.setUTCDate(current.getUTCDate() + mondayOffset)

  let lastMonth = -1

  while (current <= endDate || weeks.length === 0) {
    const week: CalendarGrid['weeks'][0] = []

    for (let d = 0; d < 7; d++) {
      const dateStr = formatDate(current)
      const inRange = current >= startDate && current <= endDate

      if (inRange) {
        week.push({
          date: dateStr,
          day: dayMap.get(dateStr) ?? null
        })
      } else {
        week.push(null)
      }

      if (current.getUTCMonth() !== lastMonth && inRange) {
        lastMonth = current.getUTCMonth()
        monthLabels.push({
          label: MONTH_NAMES[lastMonth],
          weekIndex: weeks.length
        })
      }

      current.setUTCDate(current.getUTCDate() + 1)
    }

    weeks.push(week)
  }

  return { weeks, monthLabels }
}

const getDateRange = (
  periodType: string,
  periodKey: string
): { start: Date; end: Date } => {
  if (periodType === 'yearly') {
    const year = parseInt(periodKey, 10)
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year, 11, 31))
    }
  }

  if (periodType === 'monthly') {
    const [yearStr, monthStr] = periodKey.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1
    return {
      start: new Date(Date.UTC(year, month, 1)),
      end: new Date(Date.UTC(year, month + 1, 0))
    }
  }

  const now = new Date()
  const start = new Date(
    Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())
  )
  return { start, end: now }
}

export const FitnessCalendarHeatmap: FC<Props> = ({
  days,
  metric,
  periodType,
  periodKey
}) => {
  const dayMap = useMemo(() => {
    const map = new Map<string, FitnessCalendarDay>()
    for (const day of days) {
      map.set(day.date, day)
    }
    return map
  }, [days])

  const maxValue = useMemo(() => {
    let max = 0
    for (const day of days) {
      const val = getMetricValue(day, metric)
      if (val > max) max = val
    }
    return max
  }, [days, metric])

  const { start, end } = useMemo(
    () => getDateRange(periodType, periodKey),
    [periodType, periodKey]
  )

  const grid = useMemo(
    () => buildGrid(start, end, dayMap),
    [start, end, dayMap]
  )

  if (days.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity data for this period
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-0.5">
        {/* Month labels — absolute positioning so labels align with week columns */}
        <div className="relative h-4" style={{ marginLeft: '30px' }}>
          {grid.monthLabels.map((ml, i) => (
            <span
              key={i}
              className="absolute top-0 text-xs text-muted-foreground"
              style={{ left: `${ml.weekIndex * 14}px` }}
            >
              {ml.label}
            </span>
          ))}
        </div>

        {/* Grid rows (one per day of week) */}
        <div className="flex gap-0.5">
          {/* Day labels */}
          <div className="flex w-7 flex-col gap-0.5">
            {DAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="flex h-3 items-center text-[10px] leading-none text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>

          {/* Week columns */}
          {grid.weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((cell, di) => {
                if (!cell) {
                  return <div key={di} className="h-3 w-3" />
                }

                const value = cell.day ? getMetricValue(cell.day, metric) : 0
                const colorClass = getColorClass(value, maxValue)
                const tooltip = cell.day
                  ? formatTooltipValue(cell.day, metric)
                  : `${cell.date}: No activity`

                return (
                  <div
                    key={di}
                    className={`h-3 w-3 rounded-sm ${colorClass}`}
                    title={tooltip}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
