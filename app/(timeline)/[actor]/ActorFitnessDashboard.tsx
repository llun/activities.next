'use client'

import {
  Activity,
  Bike,
  Calendar,
  Clock,
  Footprints,
  Mountain,
  Ruler,
  Waves
} from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { FitnessActivitySummary, getFitnessSummary } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'

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

const getActivityIcon = (type: string) => {
  const lower = type.toLowerCase()
  if (lower.includes('ride') || lower.includes('cycling')) return <Bike className="h-4 w-4" />
  if (lower.includes('run')) return <Footprints className="h-4 w-4" />
  if (lower.includes('swim')) return <Waves className="h-4 w-4" />
  if (lower.includes('walk') || lower.includes('hike')) return <Footprints className="h-4 w-4" />
  return <Activity className="h-4 w-4" />
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

  const setRange = (days: number) => {
    const now = new Date()
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    setStartDate(formatDateInput(start))
    setEndDate(formatDateInput(now))
  }

  const setYearToDate = () => {
    const now = new Date()
    const start = new Date(Date.UTC(now.getFullYear(), 0, 1))
    setStartDate(formatDateInput(start))
    setEndDate(formatDateInput(now))
  }

  const setAllTime = () => {
    setStartDate('2010-01-01') // Practical all-time start
    setEndDate(formatDateInput(new Date()))
  }

  return (
    <div className="space-y-6 p-4">
      {/* Filters and Presets */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRange(30)}>30 Days</Button>
          <Button variant="outline" size="sm" onClick={() => setRange(90)}>90 Days</Button>
          <Button variant="outline" size="sm" onClick={setYearToDate}>Year to Date</Button>
          <Button variant="outline" size="sm" onClick={setAllTime}>All Time</Button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
            From
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
            To
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-md border bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
      </div>

      {isInverted && (
        <p className="text-sm text-destructive font-medium">
          End date must be after start date
        </p>
      )}
      {!isInverted && !isRangeValid && (
        <p className="text-sm text-destructive font-medium">
          Date range must be at least 7 days
        </p>
      )}

      {/* Hero Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Distance</CardTitle>
            <Ruler className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDistance(totals.totalDistanceMeters)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Elevation</CardTitle>
            <Mountain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(totals.totalElevationGainMeters)} m</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(totals.totalDurationSeconds)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activities</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.count}</div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {isRangeValid && isLoading && (
        <div className="py-12 flex justify-center">
          <Activity className="h-8 w-8 animate-pulse text-muted-foreground" />
        </div>
      )}

      {isRangeValid && !isLoading && !error && summary.length === 0 && (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <Activity className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-muted-foreground">No fitness activities in this period</p>
        </div>
      )}

      {/* Activity Breakdown */}
      {isRangeValid && !isLoading && !error && summary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Activity Breakdown</CardTitle>
            <CardDescription>Summary of activities by type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm font-medium text-muted-foreground">
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 px-4 text-right">Count</th>
                    <th className="pb-3 px-4 text-right">Distance</th>
                    <th className="pb-3 px-4 text-right">Duration</th>
                    <th className="pb-3 pl-4 text-right">Elevation</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summary.map((item) => (
                    <tr key={item.activityType} className="group hover:bg-muted/50 transition-colors">
                      <td className="py-3 pr-4 flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          {getActivityIcon(item.activityType)}
                        </div>
                        <span className="font-medium">{formatActivityType(item.activityType)}</span>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">{item.count}</td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatDistance(item.totalDistanceMeters)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatDuration(item.totalDurationSeconds)}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums">
                        {Math.round(item.totalElevationGainMeters)} m
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
