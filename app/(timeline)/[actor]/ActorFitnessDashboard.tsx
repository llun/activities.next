'use client'

import { FC, useEffect, useState } from 'react'

import { FitnessActivitySummary, getFitnessSummary } from '@/lib/client'

interface Props {
  actorId: string
}

const formatDateInput = (date: Date): string => {
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

const formatActivityType = (type: string): string => {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const MIN_DATE_RANGE_MS = 7 * 24 * 60 * 60 * 1000

export const ActorFitnessDashboard: FC<Props> = ({ actorId }) => {
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return formatDateInput(thirtyDaysAgo)
  })
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
  const [summary, setSummary] = useState<FitnessActivitySummary[]>([])
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

    getFitnessSummary({
      actorId,
      startDate: startMs,
      endDate: endMsExclusive
    })
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load fitness summary.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [actorId, startDate, endDate])

  const totals = summary.reduce(
    (acc, item) => ({
      count: acc.count + item.count,
      totalDistanceMeters: acc.totalDistanceMeters + item.totalDistanceMeters,
      totalDurationSeconds:
        acc.totalDurationSeconds + item.totalDurationSeconds,
      totalElevationGainMeters:
        acc.totalElevationGainMeters + item.totalElevationGainMeters
    }),
    {
      count: 0,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      totalElevationGainMeters: 0
    }
  )

  return (
    <div className="space-y-4 p-2 sm:p-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded border bg-background px-2 py-1 text-sm"
          />
        </label>
      </div>

      {isInverted && (
        <p className="text-sm text-red-600 dark:text-red-400">
          End date must be after start date
        </p>
      )}
      {!isInverted && !isRangeValid && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Date range must be at least 7 days
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {isRangeValid && isLoading && (
        <p className="text-center text-muted-foreground">Loading...</p>
      )}

      {isRangeValid && !isLoading && !error && summary.length === 0 && (
        <p className="p-8 text-center text-muted-foreground">
          No fitness activities in this period
        </p>
      )}

      {isRangeValid && !isLoading && !error && summary.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2">Activity</th>
                <th className="px-2 py-2 text-right">Count</th>
                <th className="px-2 py-2 text-right">Distance</th>
                <th className="px-2 py-2 text-right">Duration</th>
                <th className="px-2 py-2 text-right">Elevation</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((item) => (
                <tr key={item.activityType} className="border-b">
                  <td className="px-2 py-2">
                    {formatActivityType(item.activityType)}
                  </td>
                  <td className="px-2 py-2 text-right">{item.count}</td>
                  <td className="px-2 py-2 text-right">
                    {formatDistance(item.totalDistanceMeters)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {formatDuration(item.totalDurationSeconds)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {Math.round(item.totalElevationGainMeters)} m
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 font-medium">
                <td className="px-2 py-2">Total</td>
                <td className="px-2 py-2 text-right">{totals.count}</td>
                <td className="px-2 py-2 text-right">
                  {formatDistance(totals.totalDistanceMeters)}
                </td>
                <td className="px-2 py-2 text-right">
                  {formatDuration(totals.totalDurationSeconds)}
                </td>
                <td className="px-2 py-2 text-right">
                  {Math.round(totals.totalElevationGainMeters)} m
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
