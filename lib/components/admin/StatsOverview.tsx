'use client'

import {
  Activity,
  ChevronDown,
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

import { MiniChart } from './MiniChart'

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

const calcTrend = (buckets: ServiceStatsBucket[]): number | undefined => {
  if (buckets.length < 2) return undefined
  const midPoint = Math.ceil(buckets.length / 2)
  const firstSlice = buckets.slice(0, midPoint)
  const secondSlice = buckets.slice(midPoint)
  const firstAvg =
    firstSlice.reduce((s, b) => s + b.value, 0) / firstSlice.length
  const secondAvg =
    secondSlice.reduce((s, b) => s + b.value, 0) / secondSlice.length
  if (firstAvg === 0) return secondAvg > 0 ? 100 : 0
  return Math.round(((secondAvg - firstAvg) / firstAvg) * 100)
}

export const StatsOverview: FC<Props> = ({ stats, initialBuckets }) => {
  const [range, setRange] = useState<Range>('7d')
  const [buckets, setBuckets] = useState<BucketsMap>(initialBuckets)
  const [isPending, startTransition] = useTransition()
  const [selectedCounter, setSelectedCounter] =
    useState<ServiceStatCounterType>('statuses')

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

  const selectedCard = statCards.find((c) => c.counterType === selectedCounter)!
  const selectedBuckets = normalizedBuckets[selectedCounter] ?? []
  const selectedChartData = selectedBuckets.map((b) => b.value)
  const selectedTrend = calcTrend(selectedBuckets)
  const hasActivity = selectedChartData.some((v) => v > 0)
  const SelectedIcon = selectedCard.icon

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
        className={`transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}
      >
        <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="relative">
              <select
                value={selectedCounter}
                onChange={(e) =>
                  setSelectedCounter(e.target.value as ServiceStatCounterType)
                }
                aria-label="Select statistic type"
                className="appearance-none rounded-lg border bg-background py-1.5 pl-3 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {statCards.map((card) => (
                  <option key={card.counterType} value={card.counterType}>
                    {card.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            {selectedTrend !== undefined && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  selectedTrend >= 0
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}
              >
                {selectedTrend >= 0 ? '+' : ''}
                {selectedTrend}%
              </span>
            )}
          </div>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <SelectedIcon className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold">{selectedCard.value}</p>
          </div>
          {hasActivity ? (
            <div className="h-[200px] w-full text-primary">
              <MiniChart data={selectedChartData} height={200} />
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center">
              <span className="text-sm text-muted-foreground">
                No activity in period
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {statCards.map((card) => {
            const CardIcon = card.icon
            const isSelected = card.counterType === selectedCounter
            return (
              <button
                key={card.counterType}
                type="button"
                onClick={() => setSelectedCounter(card.counterType)}
                aria-pressed={isSelected}
                className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'bg-background/80'
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className={`rounded-md p-1.5 ${isSelected ? 'bg-primary/20' : 'bg-primary/10'}`}
                  >
                    <CardIcon className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="mt-0.5 text-base font-semibold">{card.value}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
