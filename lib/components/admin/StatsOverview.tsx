'use client'

import {
  Activity,
  Database as DatabaseIcon,
  HardDrive,
  Image,
  type LucideIcon,
  MessageSquare,
  Users
} from 'lucide-react'
import { FC, useCallback, useMemo, useState, useTransition } from 'react'

import { getAllStatsBuckets } from '@/app/(timeline)/admin/actions'
import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
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

interface StatCard {
  label: string
  value: string
  icon: LucideIcon
  counterType: ServiceStatCounterType
}

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

  const [pendingRange, setPendingRange] = useState<Range | null>(null)

  const handleRangeChange = (newRange: Range) => {
    // Selecting while a range loads is ignored rather than the options being
    // disabled, so a keyboard user keeps focus on the control.
    if (isPending || newRange === range) return
    setPendingRange(newRange)
    const ms = RANGES.find((r) => r.value === newRange)!.ms
    const endTime = Date.now()
    const startTime = endTime - ms
    startTransition(async () => {
      try {
        const newBuckets = await getAllStatsBuckets(startTime, endTime)
        setBuckets(newBuckets)
        setRange(newRange)
      } catch {
        // keep previous range on failure
      } finally {
        setPendingRange(null)
      }
    })
  }

  const statCards: StatCard[] = [
    {
      label: 'Accounts',
      value: stats.totalAccounts.toLocaleString(),
      icon: Users,
      counterType: 'accounts'
    },
    {
      label: 'Actors',
      value: stats.totalActors.toLocaleString(),
      icon: DatabaseIcon,
      counterType: 'actors'
    },
    {
      label: 'Statuses',
      value: stats.totalStatuses.toLocaleString(),
      icon: MessageSquare,
      counterType: 'statuses'
    },
    {
      label: 'Media files',
      value: stats.totalMediaFiles.toLocaleString(),
      icon: Image,
      counterType: 'media-files'
    },
    {
      label: 'Media storage',
      value: formatFileSize(stats.totalMediaBytes),
      icon: HardDrive,
      counterType: 'media-bytes'
    },
    {
      label: 'Fitness files',
      value: stats.totalFitnessFiles.toLocaleString(),
      icon: Activity,
      counterType: 'fitness-files'
    },
    {
      label: 'Fitness storage',
      value: formatFileSize(stats.totalFitnessBytes),
      icon: HardDrive,
      counterType: 'fitness-bytes'
    }
  ]
  const countCards = statCards.slice(0, 4)
  const storageCards = statCards.slice(4)

  const normalizedBuckets = useMemo(() => {
    const result: Partial<BucketsMap> = {}
    for (const ct of ALL_COUNTER_TYPES) {
      result[ct] = normalizeBuckets(buckets[ct] ?? [], rangeMs)
    }
    return result as BucketsMap
  }, [buckets, rangeMs])

  const formatValue = useCallback(
    (val: number, type: ServiceStatCounterType) =>
      type.endsWith('-bytes') ? formatFileSize(val) : val.toLocaleString(),
    []
  )

  const bucketSums = useMemo(() => {
    const sums: Partial<Record<ServiceStatCounterType, number>> = {}
    for (const ct of ALL_COUNTER_TYPES) {
      sums[ct] = (buckets[ct] ?? []).reduce((s, b) => s + b.value, 0)
    }
    return sums as Record<ServiceStatCounterType, number>
  }, [buckets])

  const selectedCard = statCards.find((c) => c.counterType === selectedCounter)!
  const selectedBuckets = normalizedBuckets[selectedCounter] ?? []
  const selectedChartData = selectedBuckets.map((b) => b.value)
  const selectedTrend = calcTrend(selectedBuckets)
  const hasActivity = selectedChartData.some((v) => v > 0)

  const rangeSumFormatted = formatValue(
    bucketSums[selectedCounter],
    selectedCounter
  )
  const rangeLabel = RANGES.find((r) => r.value === range)!.label

  const renderCell = (card: StatCard) => (
    <StatCell
      key={card.counterType}
      label={card.label}
      icon={card.icon}
      value={card.value}
      selected={card.counterType === selectedCounter}
      onSelect={() => setSelectedCounter(card.counterType)}
    />
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Service usage statistics."
        stackActionsOnMobile
        actions={
          <SegmentedControl
            aria-label="Time range"
            size="sm"
            items={RANGES.map((r) => ({
              value: r.value,
              label: r.label
            }))}
            value={pendingRange ?? range}
            onValueChange={(next) => handleRangeChange(next as Range)}
          />
        }
      />

      <div
        aria-busy={isPending}
        className={`space-y-6 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}
      >
        <div
          role="group"
          aria-label="Chart statistic"
          aria-describedby="overview-totals-hint"
          className="space-y-3"
        >
          <p
            id="overview-totals-hint"
            className="text-muted-foreground text-sm"
          >
            All-time totals. Pick one to chart how many were added in the
            period.
          </p>
          <StatStrip columns={4}>{countCards.map(renderCell)}</StatStrip>
          <StatStrip columns={3}>{storageCards.map(renderCell)}</StatStrip>
        </div>

        <Section
          title={selectedCard.label}
          meta={`${rangeSumFormatted} new in the last ${rangeLabel}`}
          actions={
            selectedTrend !== undefined ? (
              <span className="text-muted-foreground text-sm">
                <span
                  className={
                    selectedTrend > 0
                      ? 'text-success-text font-medium'
                      : selectedTrend < 0
                        ? 'text-destructive-text font-medium'
                        : 'text-foreground font-medium'
                  }
                >
                  {selectedTrend > 0 ? '+' : ''}
                  {selectedTrend}%
                </span>{' '}
                vs the first half of the period
              </span>
            ) : null
          }
        >
          <Frame className="p-4">
            {hasActivity ? (
              <div className="text-primary h-[200px] w-full">
                <MiniChart data={selectedChartData} height={200} />
              </div>
            ) : (
              <div className="flex h-[200px] items-center justify-center">
                <span className="text-muted-foreground text-sm">
                  No activity in period
                </span>
              </div>
            )}
          </Frame>
        </Section>
      </div>
    </div>
  )
}
