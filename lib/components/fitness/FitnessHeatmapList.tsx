'use client'

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { FC, useState } from 'react'

import { FitnessRouteHeatmapSummaryData } from '@/lib/client'
import { describeRegions } from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'

interface FitnessHeatmapListProps {
  heatmaps: FitnessRouteHeatmapSummaryData[]
  onSelect: (heatmap: FitnessRouteHeatmapSummaryData) => void
  onRetry: (heatmap: FitnessRouteHeatmapSummaryData) => Promise<void>
  onRemove: (heatmap: FitnessRouteHeatmapSummaryData) => void
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

const numberFormatter = new Intl.NumberFormat()
const formatCount = (value: number): string => numberFormatter.format(value)

interface HeatmapProgress {
  percent: number | null
  label: string
}

/**
 * Derives a progress label (and percentage when known) for an in-flight
 * heatmap. `cursorOffset` is the number of files scanned; `totalCount` is the
 * denominator the job computed at the start of the run. `totalCount === 0`
 * means the total is not yet known, so we report an indeterminate count.
 */
const getHeatmapProgress = (
  heatmap: FitnessRouteHeatmapSummaryData
): HeatmapProgress => {
  const total = heatmap.totalCount
  const scanned = heatmap.cursorOffset

  if (total > 0) {
    const cappedScanned = Math.min(scanned, total)
    const percent = Math.max(
      0,
      Math.min(100, Math.round((cappedScanned / total) * 100))
    )
    return {
      percent,
      label: `${formatCount(cappedScanned)} / ${formatCount(total)} files (${percent}%)`
    }
  }

  return {
    percent: null,
    label: scanned > 0 ? `${formatCount(scanned)} files scanned` : 'Starting…'
  }
}

interface ProgressBarProps {
  percent: number | null
  label: string
}

const ProgressBar: FC<ProgressBarProps> = ({ percent, label }) => (
  <span className="flex flex-col gap-1">
    <span
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label="Heatmap generation progress"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { 'aria-valuenow': percent })}
    >
      <span
        className={cn(
          'block h-full rounded-full bg-blue-500 transition-[width] duration-500 dark:bg-blue-400',
          percent === null && 'w-1/3 animate-pulse'
        )}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </span>
    <span className="text-xs text-muted-foreground">{label}</span>
  </span>
)

interface RetryButtonProps {
  heatmap: FitnessRouteHeatmapSummaryData
  onRetry: (heatmap: FitnessRouteHeatmapSummaryData) => Promise<void>
  label?: string
}

const RetryButton: FC<RetryButtonProps> = ({
  heatmap,
  onRetry,
  label = 'Retry'
}) => {
  const [isRetrying, setIsRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
          'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
            setError('Retry failed. Please try again.')
          } finally {
            setIsRetrying(false)
          }
        }}
      >
        <RefreshCw className={cn('size-3', isRetrying && 'animate-spin')} />
        {label}
      </button>
      {error && (
        <span aria-live="polite" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  )
}

interface RemoveButtonProps {
  heatmap: FitnessRouteHeatmapSummaryData
  onRemove: (heatmap: FitnessRouteHeatmapSummaryData) => void
}

const RemoveButton: FC<RemoveButtonProps> = ({ heatmap, onRemove }) => (
  <button
    type="button"
    className={cn(
      'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
      'text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    )}
    onClick={(e) => {
      e.stopPropagation()
      e.preventDefault()
      onRemove(heatmap)
    }}
  >
    <Trash2 className="size-3" />
    Remove
  </button>
)

interface HeatmapRowProps {
  heatmap: FitnessRouteHeatmapSummaryData
  onSelect: (heatmap: FitnessRouteHeatmapSummaryData) => void
  onRetry: (heatmap: FitnessRouteHeatmapSummaryData) => Promise<void>
  onRemove: (heatmap: FitnessRouteHeatmapSummaryData) => void
  currentTime: number
}

const HeatmapRow: FC<HeatmapRowProps> = ({
  heatmap,
  onSelect,
  onRetry,
  onRemove,
  currentTime
}) => {
  const regionLabel = describeRegions(heatmap.region ?? '')
  const isGenerating = heatmap.status === 'generating'
  const isPartialComplete = heatmap.status === 'completed' && heatmap.isPartial
  // "Not in-flight" rows can be pruned individually; active jobs use the bulk
  // clear instead so removal never races a running generation.
  const canRemove =
    heatmap.status === 'failed' || heatmap.status === 'completed'

  const statusIcon = (() => {
    switch (heatmap.status) {
      case 'pending':
        return <Clock className="size-3" />
      case 'generating':
        return <Loader2 className="size-3 animate-spin" />
      case 'completed':
        if (heatmap.isPartial) {
          return <AlertCircle className="size-3 text-amber-600" />
        }
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
        if (heatmap.isPartial) {
          return <span className="text-amber-600">Partial</span>
        }
        return <span className="text-muted-foreground">Completed</span>
      case 'failed':
        return <span className="text-destructive">Failed</span>
      default:
        return null
    }
  })()

  const progress = isGenerating ? getHeatmapProgress(heatmap) : null

  return (
    <div className="flex items-start gap-2 rounded p-2 hover:bg-muted">
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(heatmap)}
      >
        <span className="flex items-center gap-1.5 text-xs">
          {statusIcon}
          {statusLabel}
          <span className="ml-auto text-muted-foreground">
            {formatRelativeTime(currentTime - heatmap.updatedAt)}
          </span>
        </span>
        <span className="break-words text-sm">
          {formatActivityType(heatmap.activityType)} ·{' '}
          {formatPeriod(heatmap.periodType, heatmap.periodKey)}
        </span>
        <span className="inline-flex max-w-full items-center gap-1 break-words rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {regionLabel}
        </span>
        {progress && (
          <ProgressBar percent={progress.percent} label={progress.label} />
        )}
        {heatmap.status === 'completed' && heatmap.pointCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {formatCount(heatmap.activityCount)} activities ·{' '}
            {formatCount(heatmap.pointCount)} points
          </span>
        )}
        {heatmap.status === 'failed' && heatmap.error && (
          <span className="block text-xs text-destructive">
            {heatmap.error}
          </span>
        )}
      </button>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {(heatmap.status === 'failed' || isPartialComplete) && (
          <RetryButton
            heatmap={heatmap}
            onRetry={onRetry}
            label={heatmap.isPartial ? 'Resume' : 'Retry'}
          />
        )}
        {canRemove && <RemoveButton heatmap={heatmap} onRemove={onRemove} />}
      </span>
    </div>
  )
}

export const FitnessHeatmapList: FC<FitnessHeatmapListProps> = ({
  heatmaps,
  onSelect,
  onRetry,
  onRemove,
  currentTime
}) => {
  const [isCompletedOpen, setIsCompletedOpen] = useState(false)

  const active = heatmaps
    .filter(
      (h) =>
        ['pending', 'generating', 'failed'].includes(h.status) ||
        (h.status === 'completed' && h.isPartial)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const completed = heatmaps
    .filter((h) => h.status === 'completed' && !h.isPartial)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  if (active.length === 0 && completed.length === 0) {
    return <p className="text-sm text-muted-foreground">No heatmaps yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {active.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            In Progress &amp; Needs Attention
          </p>
          {active.map((heatmap) => (
            <HeatmapRow
              key={heatmap.id}
              heatmap={heatmap}
              onSelect={onSelect}
              onRetry={onRetry}
              onRemove={onRemove}
              currentTime={currentTime}
            />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={isCompletedOpen}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                onRemove={onRemove}
                currentTime={currentTime}
              />
            ))}
        </div>
      )}
    </div>
  )
}
