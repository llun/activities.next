'use client'

import {
  Activity,
  Database as DatabaseIcon,
  HardDrive,
  Image,
  MessageSquare,
  Users
} from 'lucide-react'
import { ElementType, FC, useMemo, useState, useTransition } from 'react'

import { getAllStatsBuckets } from '@/app/(timeline)/admin/actions'
import {
  ALL_COUNTER_TYPES,
  ServiceStatCounterType,
  ServiceStats,
  ServiceStatsBucket
} from '@/lib/types/database/operations'
import { formatFileSize } from '@/lib/utils/formatFileSize'

import { StatCard } from './StatCard'

type Range = '24h' | '7d' | '30d' | '90d'

const RANGES: { label: string; value: Range; ms: number }[] = [
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', value: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '90d', value: '90d', ms: 90 * 24 * 60 * 60 * 1000 }
]

const HOUR_MS = 60 * 60 * 1000

type BucketsMap = Record<ServiceStatCounterType, ServiceStatsBucket[]>

interface Props {
  stats: ServiceStats
  initialBuckets: BucketsMap
}

/**
 * Fill sparse bucket data with zeros for missing hours.
 * This ensures sparklines show the full time window accurately.
 */
const normalizeBuckets = (
  buckets: ServiceStatsBucket[],
  rangeMs: number
): ServiceStatsBucket[] => {
  const endTime = Date.now()
  const startTime = endTime - rangeMs

  // For very long ranges, downsample to avoid thousands of points
  const totalHours = Math.ceil(rangeMs / HOUR_MS)
  const step = totalHours > 720 ? Math.ceil(totalHours / 360) : 1
  const stepMs = step * HOUR_MS

  // Align to epoch-zero multiples of stepMs so bucketing and rendering
  // use the same grid. Without this, the two grids differ by
  // startTime % stepMs and bucketMap lookups always miss.
  const alignedStart = Math.floor(startTime / stepMs) * stepMs

  const bucketMap = new Map<number, number>()
  for (const b of buckets) {
    const key = Math.floor(b.bucketHour / stepMs) * stepMs
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + b.value)
  }

  const result: ServiceStatsBucket[] = []
  for (let t = alignedStart; t <= endTime; t += stepMs) {
    result.push({ bucketHour: t, value: bucketMap.get(t) ?? 0 })
  }
  return result
}

export const StatsOverview: FC<Props> = ({ stats, initialBuckets }) => {
  const [range, setRange] = useState<Range>('7d')
  const [buckets, setBuckets] = useState<BucketsMap>(initialBuckets)
  const [isPending, startTransition] = useTransition()

  const rangeMs = RANGES.find((r) => r.value === range)!.ms

  const handleRangeChange = (newRange: Range) => {
    const prevRange = range
    setRange(newRange)
    const ms = RANGES.find((r) => r.value === newRange)!.ms
    const endTime = Date.now()
    const startTime = endTime - ms
    startTransition(async () => {
      try {
        const newBuckets = await getAllStatsBuckets(startTime, endTime)
        setBuckets(newBuckets)
      } catch {
        setRange(prevRange)
      }
    })
  }

  const statCards: {
    label: string
    value: string
    icon: ElementType
    counterType: ServiceStatCounterType
  }[] = [
    {
      label: 'Total Accounts',
      value: stats.totalAccounts.toLocaleString(),
      icon: Users,
      counterType: 'accounts'
    },
    {
      label: 'Total Actors',
      value: stats.totalActors.toLocaleString(),
      icon: DatabaseIcon,
      counterType: 'actors'
    },
    {
      label: 'Total Statuses',
      value: stats.totalStatuses.toLocaleString(),
      icon: MessageSquare,
      counterType: 'statuses'
    },
    {
      label: 'Total Media Files',
      value: stats.totalMediaFiles.toLocaleString(),
      icon: Image,
      counterType: 'media-files'
    },
    {
      label: 'Media Storage',
      value: formatFileSize(stats.totalMediaBytes),
      icon: HardDrive,
      counterType: 'media-bytes'
    },
    {
      label: 'Total Fitness Files',
      value: stats.totalFitnessFiles.toLocaleString(),
      icon: Activity,
      counterType: 'fitness-files'
    },
    {
      label: 'Fitness Storage',
      value: formatFileSize(stats.totalFitnessBytes),
      icon: HardDrive,
      counterType: 'fitness-bytes'
    }
  ]

  const normalizedBuckets = useMemo(() => {
    const result: Partial<BucketsMap> = {}
    for (const ct of ALL_COUNTER_TYPES) {
      result[ct] = normalizeBuckets(buckets[ct] ?? [], rangeMs)
    }
    return result as BucketsMap
  }, [buckets, rangeMs])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Service usage statistics
          </p>
        </div>
        <div
          className="flex items-center gap-1 rounded-lg border bg-background p-1"
          role="tablist"
        >
          {RANGES.map((r) => (
            <button
              key={r.value}
              role="tab"
              aria-selected={range === r.value}
              aria-pressed={range === r.value}
              onClick={() => handleRangeChange(r.value)}
              disabled={isPending}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                range === r.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              } disabled:opacity-50`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}
      >
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            buckets={normalizedBuckets[card.counterType] ?? []}
          />
        ))}
      </div>
    </div>
  )
}
