'use client'

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { FC, useState } from 'react'

import { FitnessHeatmapData } from '@/lib/client'
import { REGION_MAP } from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'

interface FitnessHeatmapListProps {
  heatmaps: FitnessHeatmapData[]
  onSelect: (heatmap: FitnessHeatmapData) => void
  onRetry: (heatmap: FitnessHeatmapData) => Promise<void>
  currentTime: number
}

const formatActivityType = (type?: string): string =>
  type
    ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'All'

const formatPeriod = (periodType: string, periodKey: string): string => {
  if (periodType === 'all_time') return 'All time'
  return periodKey
}

const formatRelativeTime = (diffMs: number): string => {
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return `${Math.floor(diffMs / 86_400_000)}d ago`
}

interface RetryButtonProps {
  heatmap: FitnessHeatmapData
  onRetry: (heatmap: FitnessHeatmapData) => Promise<void>
}

const RetryButton: FC<RetryButtonProps> = ({ heatmap, onRetry }) => {
  const [isRetrying, setIsRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
          'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
          isRetrying && 'pointer-events-none opacity-50'
        )}
        disabled={isRetrying}
        onClick={async (e) => {
          e.stopPropagation()
          e.preventDefault()
          setIsRetrying(true)
          setError(null)
          try {
            await onRetry(heatmap)
          } catch {
            setIsRetrying(false)
            setError('Retry failed. Please try again.')
          }
        }}
      >
        <RefreshCw className={cn('size-3', isRetrying && 'animate-spin')} />
        Retry
      </button>
      {error && <span className="text-destructive text-xs">{error}</span>}
    </span>
  )
}

interface HeatmapRowProps {
  heatmap: FitnessHeatmapData
  onSelect: (heatmap: FitnessHeatmapData) => void
  onRetry: (heatmap: FitnessHeatmapData) => Promise<void>
  currentTime: number
}

const HeatmapRow: FC<HeatmapRowProps> = ({
  heatmap,
  onSelect,
  onRetry,
  currentTime
}) => {
  const regionLabel =
    heatmap.region && heatmap.region !== ''
      ? heatmap.region
          .split(',')
          .map((id) => REGION_MAP.get(id.trim())?.name ?? id.trim())
          .join(', ')
      : null

  const statusIcon = (() => {
    switch (heatmap.status) {
      case 'pending':
        return <Clock className="size-3" />
      case 'generating':
        return <Loader2 className="size-3 animate-spin" />
      case 'completed':
        return <CheckCircle2 className="size-3" />
      case 'failed':
        return <AlertCircle className="size-3 text-destructive" />
      default:
        return null
    }
  })()

  const statusLabel = (() => {
    switch (heatmap.status) {
      case 'pending':
        return <span className="text-muted-foreground">Queued</span>
      case 'generating':
        return (
          <span className="text-blue-600 dark:text-blue-400">Generating…</span>
        )
      case 'completed':
        return <span className="text-muted-foreground">Completed</span>
      case 'failed':
        return <span className="text-destructive">Failed</span>
      default:
        return null
    }
  })()

  return (
    <div
      role="button"
      tabIndex={0}
      className="w-full text-left p-2 rounded hover:bg-muted flex flex-col gap-1 cursor-pointer"
      onClick={() => onSelect(heatmap)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(heatmap)
        }
      }}
    >
      <div className="flex items-center gap-1.5 text-xs">
        {statusIcon}
        {statusLabel}
        <span className="text-muted-foreground ml-auto">
          {formatRelativeTime(currentTime - heatmap.updatedAt)}
        </span>
      </div>
      <div className="text-sm">
        {formatActivityType(heatmap.activityType)} ·{' '}
        {formatPeriod(heatmap.periodType, heatmap.periodKey)}
      </div>
      {regionLabel && (
        <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {regionLabel}
        </span>
      )}
      {heatmap.status === 'failed' && heatmap.error && (
        <p className="text-xs text-destructive">{heatmap.error}</p>
      )}
      {heatmap.status === 'failed' && (
        <RetryButton heatmap={heatmap} onRetry={onRetry} />
      )}
    </div>
  )
}

export const FitnessHeatmapList: FC<FitnessHeatmapListProps> = ({
  heatmaps,
  onSelect,
  onRetry,
  currentTime
}) => {
  const [isCompletedOpen, setIsCompletedOpen] = useState(false)

  const active = heatmaps
    .filter((h) => ['pending', 'generating', 'failed'].includes(h.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const completed = heatmaps
    .filter((h) => h.status === 'completed')
    .sort((a, b) => b.updatedAt - a.updatedAt)

  if (active.length === 0 && completed.length === 0) {
    return <p className="text-sm text-muted-foreground">No heatmaps yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {active.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            In Progress &amp; Failed
          </p>
          {active.map((heatmap) => (
            <HeatmapRow
              key={heatmap.id}
              heatmap={heatmap}
              onSelect={onSelect}
              onRetry={onRetry}
              currentTime={currentTime}
            />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setIsCompletedOpen((prev) => !prev)}
          >
            {isCompletedOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Completed ({completed.length})
          </button>
          {isCompletedOpen &&
            completed.map((heatmap) => (
              <HeatmapRow
                key={heatmap.id}
                heatmap={heatmap}
                onSelect={onSelect}
                onRetry={onRetry}
                currentTime={currentTime}
              />
            ))}
        </div>
      )}
    </div>
  )
}
