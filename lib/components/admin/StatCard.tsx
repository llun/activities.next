'use client'

import { ElementType, FC, useMemo } from 'react'

import { ServiceStatsBucket } from '@/lib/types/database/operations'

import { MiniChart } from './MiniChart'

interface Props {
  label: string
  value: string
  icon: ElementType
  buckets: ServiceStatsBucket[]
  color?: string
}

const buildChartData = (buckets: ServiceStatsBucket[]): number[] => {
  if (buckets.length === 0) return []
  return buckets.map((b) => b.value)
}

const calcTrend = (buckets: ServiceStatsBucket[]): number | null => {
  if (buckets.length < 2) return null
  const half = Math.floor(buckets.length / 2)
  const first = buckets.slice(0, half).reduce((s, b) => s + b.value, 0)
  const second = buckets.slice(half).reduce((s, b) => s + b.value, 0)
  if (first === 0) return second > 0 ? 100 : 0
  return Math.round(((second - first) / first) * 100)
}

export const StatCard: FC<Props> = ({
  label,
  value,
  icon: Icon,
  buckets,
  color = 'hsl(var(--primary))'
}) => {
  const chartData = useMemo(() => buildChartData(buckets), [buckets])
  const trend = useMemo(() => calcTrend(buckets), [buckets])
  const hasActivity = chartData.some((v) => v > 0)

  return (
    <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
        {trend !== null && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              trend >= 0
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            {trend >= 0 ? '+' : ''}
            {trend}%
          </span>
        )}
      </div>
      {hasActivity ? (
        <div className="h-10 w-full text-primary">
          <MiniChart data={chartData} color={color} height={40} />
        </div>
      ) : (
        <div className="flex h-10 items-center justify-center">
          <span className="text-xs text-muted-foreground">
            No activity in period
          </span>
        </div>
      )}
    </div>
  )
}
