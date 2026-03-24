'use client'

import {
  Activity,
  Database as DatabaseIcon,
  HardDrive,
  Image,
  MessageSquare,
  Users
} from 'lucide-react'
import { FC, useState, useTransition } from 'react'

import { getAllStatsBuckets } from '@/app/(timeline)/admin/actions'
import {
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

type BucketsMap = Record<ServiceStatCounterType, ServiceStatsBucket[]>

interface Props {
  stats: ServiceStats
  initialBuckets: BucketsMap
}

export const StatsOverview: FC<Props> = ({ stats, initialBuckets }) => {
  const [range, setRange] = useState<Range>('7d')
  const [buckets, setBuckets] = useState<BucketsMap>(initialBuckets)
  const [isPending, startTransition] = useTransition()

  const handleRangeChange = (newRange: Range) => {
    setRange(newRange)
    const rangeMs = RANGES.find((r) => r.value === newRange)!.ms
    const endTime = Date.now()
    const startTime = endTime - rangeMs
    startTransition(async () => {
      const newBuckets = await getAllStatsBuckets(startTime, endTime)
      setBuckets(newBuckets)
    })
  }

  const statCards = [
    {
      label: 'Total Accounts',
      value: stats.totalAccounts.toLocaleString(),
      icon: Users,
      counterType: 'accounts' as ServiceStatCounterType
    },
    {
      label: 'Total Actors',
      value: stats.totalActors.toLocaleString(),
      icon: DatabaseIcon,
      counterType: 'actors' as ServiceStatCounterType
    },
    {
      label: 'Total Statuses',
      value: stats.totalStatuses.toLocaleString(),
      icon: MessageSquare,
      counterType: 'statuses' as ServiceStatCounterType
    },
    {
      label: 'Total Media Files',
      value: stats.totalMediaFiles.toLocaleString(),
      icon: Image,
      counterType: 'media-files' as ServiceStatCounterType
    },
    {
      label: 'Media Storage',
      value: formatFileSize(stats.totalMediaBytes),
      icon: HardDrive,
      counterType: 'media-bytes' as ServiceStatCounterType
    },
    {
      label: 'Total Fitness Files',
      value: stats.totalFitnessFiles.toLocaleString(),
      icon: Activity,
      counterType: 'fitness-files' as ServiceStatCounterType
    },
    {
      label: 'Fitness Storage',
      value: formatFileSize(stats.totalFitnessBytes),
      icon: HardDrive,
      counterType: 'fitness-bytes' as ServiceStatCounterType
    }
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Service usage statistics
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
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
            buckets={buckets[card.counterType] ?? []}
          />
        ))}
      </div>
    </div>
  )
}
