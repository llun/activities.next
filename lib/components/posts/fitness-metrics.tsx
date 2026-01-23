'use client'

import { Activity, Heart, Timer, TrendingUp, Zap } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { Card, CardContent } from '@/lib/components/ui/card'

interface FitnessActivity {
  id: string
  type: string | null
  name: string | null
  distance: number | null
  movingTime: number | null
  averageSpeed: number | null
  averageHeartrate: number | null
  averageWatts: number | null
  totalElevationGain: number | null
  calories: number | null
}

interface FitnessMetricsProps {
  statusId: string
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatDistance(meters: number): string {
  const km = meters / 1000
  return `${km.toFixed(2)} km`
}

function formatPace(metersPerSecond: number): string {
  // Convert to min/km
  const minutesPerKm = 1000 / 60 / metersPerSecond
  const minutes = Math.floor(minutesPerKm)
  const seconds = Math.round((minutesPerKm - minutes) * 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`
}

export const FitnessMetrics: FC<FitnessMetricsProps> = ({ statusId }) => {
  const [activity, setActivity] = useState<FitnessActivity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const response = await fetch(
          `/api/v1/statuses/${encodeURIComponent(statusId)}/fitness`
        )

        if (response.ok) {
          const data = await response.json()
          setActivity(data)
        } else if (response.status === 404) {
          // No fitness activity for this status, which is fine
          setActivity(null)
        } else {
          console.error('Failed to fetch fitness activity:', response.status)
          setActivity(null)
        }
      } catch (error) {
        console.error('Failed to fetch fitness activity:', error)
        setActivity(null)
      } finally {
        setLoading(false)
      }
    }

    fetchActivity()
  }, [statusId])

  // If loading, don't show anything
  if (loading) {
    return null
  }

  // If no activity data, don't show the component
  if (!activity) {
    return null
  }

  return (
    <Card className="my-3">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="size-5 text-primary" />
          <h3 className="font-semibold">{activity.name || activity.type}</h3>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {activity.distance !== null && (
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">Distance</div>
                <div className="font-semibold">
                  {formatDistance(activity.distance)}
                </div>
              </div>
            </div>
          )}

          {activity.movingTime !== null && (
            <div className="flex items-center gap-2">
              <Timer className="size-4 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">Time</div>
                <div className="font-semibold">
                  {formatDuration(activity.movingTime)}
                </div>
              </div>
            </div>
          )}

          {activity.averageSpeed !== null && (
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">Pace</div>
                <div className="font-semibold">
                  {formatPace(activity.averageSpeed)}
                </div>
              </div>
            </div>
          )}

          {activity.averageHeartrate !== null && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">❤️</span>
              <div>
                <div className="text-muted-foreground text-xs">Avg HR</div>
                <div className="font-semibold">
                  {Math.round(activity.averageHeartrate)} bpm
                </div>
              </div>
            </div>
          )}

          {activity.averageWatts !== null && (
            <div className="flex items-center gap-2">
              <Heart className="size-4 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">Avg Power</div>
                <div className="font-semibold">
                  {Math.round(activity.averageWatts)}W
                </div>
              </div>
            </div>
          )}

          {activity.totalElevationGain !== null &&
            activity.totalElevationGain > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">⛰️</span>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Elevation
                  </div>
                  <div className="font-semibold">
                    {Math.round(activity.totalElevationGain)}m
                  </div>
                </div>
              </div>
            )}

          {activity.calories !== null && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">🔥</span>
              <div>
                <div className="text-muted-foreground text-xs">Calories</div>
                <div className="font-semibold">
                  {Math.round(activity.calories)} kcal
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
