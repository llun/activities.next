'use client'

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Flame,
  Globe,
  Loader2,
  Maximize,
  RefreshCw
} from 'lucide-react'
import { FC, ReactNode } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { PickerRegion } from '@/lib/components/fitness/HeatmapRegionPicker'
import { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'
import { Button } from '@/lib/components/ui/button'
import { formatRectRegion } from '@/lib/fitness/regions'
import { formatRelativeTime } from '@/lib/fitness/relativeTime'
import { cn } from '@/lib/utils'

const numberFormatter = new Intl.NumberFormat()
const formatCount = (value: number): string => numberFormatter.format(value)

const formatDuration = (startMs: number, endMs: number): string | null => {
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return null
  }
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000))
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** Display-only generation state for the detail page (mirrors the picker atom). */
type TaskState = 'pending' | 'generating' | 'completed' | 'partial' | 'failed'

const KNOWN_TASK_STATES: readonly TaskState[] = [
  'pending',
  'generating',
  'completed',
  'partial',
  'failed'
]

const resolveTaskState = (heatmap: FitnessRouteHeatmapData): TaskState => {
  if (heatmap.status === 'completed') {
    return heatmap.isPartial ? 'partial' : 'completed'
  }
  // `status` is typed as a bare string at the client boundary, so guard against
  // an unexpected value rather than indexing TASK_META with an unknown key.
  return KNOWN_TASK_STATES.includes(heatmap.status as TaskState)
    ? (heatmap.status as TaskState)
    : 'pending'
}

interface TaskMeta {
  icon: ReactNode
  label: string
  className: string
}

const TASK_META: Record<TaskState, TaskMeta> = {
  generating: {
    icon: <Loader2 className="size-3.5 animate-spin" />,
    label: 'Generating…',
    className: 'text-blue-600 dark:text-blue-400'
  },
  pending: {
    icon: <Clock className="size-3.5" />,
    label: 'Queued',
    className: 'text-muted-foreground'
  },
  completed: {
    icon: <Check className="size-3.5" />,
    label: 'Completed',
    className: 'text-green-600 dark:text-green-500'
  },
  partial: {
    icon: <AlertTriangle className="size-3.5" />,
    label: 'Partial',
    className: 'text-amber-600 dark:text-amber-500'
  },
  failed: {
    icon: <AlertTriangle className="size-3.5" />,
    label: 'Failed',
    className: 'text-destructive'
  }
}

interface GenerationTaskRowProps {
  heatmap: FitnessRouteHeatmapData
  progressPercent: number | null
  currentTime: number
  isRetrying: boolean
  onRetry: () => void
}

// The backend keeps a single heatmap row per region key (one kept version), so
// this renders that row as the region's current/most-recent generation run —
// the attempt log, not a full multi-run history.
const GenerationTaskRow: FC<GenerationTaskRowProps> = ({
  heatmap,
  progressPercent,
  currentTime,
  isRetrying,
  onRetry
}) => {
  const state = resolveTaskState(heatmap)
  const meta = TASK_META[state]
  const canRetry = state === 'failed' || state === 'partial'
  const isTerminal =
    state === 'completed' || state === 'partial' || state === 'failed'
  const startedLabel = formatRelativeTime(currentTime - heatmap.createdAt)
  const duration = isTerminal
    ? formatDuration(heatmap.createdAt, heatmap.updatedAt)
    : null

  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-b-0">
      <span
        className={cn(
          'mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium',
          meta.className
        )}
      >
        {meta.icon}
        <span className="whitespace-nowrap">
          {state === 'generating' && progressPercent != null
            ? `Generating… ${progressPercent}%`
            : meta.label}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        {state === 'generating' && (
          <span
            className="mt-1 block h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Heatmap generation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(progressPercent == null
              ? {}
              : { 'aria-valuenow': progressPercent })}
          >
            <span
              className={cn(
                'block h-full rounded-full bg-blue-500 transition-[width] duration-500 dark:bg-blue-400',
                progressPercent == null && 'w-1/3 animate-pulse'
              )}
              style={
                progressPercent == null
                  ? undefined
                  : { width: `${progressPercent}%` }
              }
            />
          </span>
        )}
        {state === 'failed' && heatmap.error && (
          <div className="text-[11px] text-destructive">{heatmap.error}</div>
        )}
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Started {startedLabel}
          {duration ? ` · took ${duration}` : ''}
        </div>
      </div>
      {canRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2.5 text-xs"
          disabled={isRetrying}
          onClick={onRetry}
        >
          <RefreshCw className={cn('size-3', isRetrying && 'animate-spin')} />
          {state === 'partial' ? 'Resume' : 'Retry'}
        </Button>
      )}
    </div>
  )
}

export interface RegionHeatmapDetailProps {
  region: PickerRegion
  /** Pre-formatted activity + period source labels. */
  meta: { activity: string; period: string }
  heatmap: FitnessRouteHeatmapData | null
  mapboxAccessToken?: string
  currentTime: number
  /** The focused heatmap is being (re)loaded from the server. */
  isLoading: boolean
  /** A generation run is in flight (queued/generating) for this region. */
  busy: boolean
  /** Polling gave up on a stuck run; offer a retry instead of a forever spinner. */
  pollingStalled: boolean
  /** Generation/retry progress, 0–100, or null when the total is unknown. */
  progressPercent: number | null
  isRetrying: boolean
  /** Generation has been queued but no heatmap row has appeared yet. */
  generationQueued: boolean
  error: string | null
  onBack: () => void
  onGenerate: () => void
  onRetry: () => void
}

export const RegionHeatmapDetail: FC<RegionHeatmapDetailProps> = ({
  region,
  meta,
  heatmap,
  mapboxAccessToken,
  currentTime,
  isLoading,
  busy,
  pollingStalled,
  progressPercent,
  isRetrying,
  generationQueued,
  error,
  onBack,
  onGenerate,
  onRetry
}) => {
  const isWorld = region.type === 'world'
  const title = isWorld ? 'Whole world' : region.name || 'Map area'
  // A completed run is a kept version even when it found no routes — the map
  // itself renders a "No route data for this selection" state — so gate on the
  // completed status, not the point count. This keeps the header ("Regenerate"),
  // the current-version line, and the Generation-tasks row ("Completed") all
  // consistent instead of contradicting each other with "No heatmap yet".
  const hasMap = heatmap?.status === 'completed'
  // While the focused heatmap is still loading and nothing is in flight yet,
  // show a neutral loader instead of flashing the "No heatmap yet" empty state.
  const showLoading = isLoading && !heatmap && !busy && !pollingStalled
  const hasVersion = hasMap
  const isPartial = Boolean(heatmap?.isPartial)
  // When stalled, the banner + Generation-tasks panel convey state; suppress the
  // redundant "No heatmap yet" empty block.
  const showEmptyState = !showLoading && !hasMap && !pollingStalled

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" /> All regions
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            {isWorld ? (
              <Globe className="size-5" />
            ) : (
              <Maximize className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            {/* h2: the page-level PageHeader ("Heatmaps") already owns the h1. */}
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {isWorld
                ? 'Entire globe — every recorded activity'
                : formatRectRegion(region)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                <Activity className="size-3" />
                {meta.activity}
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                <Calendar className="size-3" />
                {meta.period}
              </span>
            </div>
          </div>
        </div>
        <Button type="button" size="sm" disabled={busy} onClick={onGenerate}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : pollingStalled ? (
            <RefreshCw className="size-4" />
          ) : (
            <Flame className="size-4" />
          )}
          {busy
            ? 'Generating…'
            : pollingStalled
              ? 'Retry'
              : hasVersion
                ? 'Regenerate'
                : 'Generate'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {pollingStalled && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" />
            This route cache is taking longer than expected.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={isRetrying}
            onClick={onRetry}
          >
            <RefreshCw className={cn('size-3', isRetrying && 'animate-spin')} />
            Retry
          </Button>
        </div>
      )}

      {showLoading ? (
        <div
          role="status"
          className="flex h-[420px] items-center justify-center gap-2 rounded-xl border bg-muted/40 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" /> Loading heatmap…
        </div>
      ) : hasMap ? (
        <div>
          {isPartial && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Partial route cache capped at 1M files.
            </div>
          )}
          <div className="overflow-hidden rounded-xl border">
            <RouteHeatmapMap
              heatmap={heatmap}
              mapboxAccessToken={mapboxAccessToken}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 text-green-600 dark:text-green-500" />
              Current version · generated{' '}
              {formatRelativeTime(currentTime - heatmap.updatedAt)}
              <span className="text-muted-foreground/60">·</span> only the
              latest version is kept
            </span>
            {heatmap.pointCount > 0 && (
              <span>
                {formatCount(heatmap.activityCount)} activities ·{' '}
                {formatCount(heatmap.pointCount)} points
              </span>
            )}
          </div>
        </div>
      ) : showEmptyState ? (
        <div
          {...(busy ? { role: 'status' } : {})}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Flame className="size-5" />
            )}
          </span>
          <div>
            <div className="text-sm font-medium">
              {busy ? 'Building your heatmap…' : 'No heatmap yet'}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {busy
                ? 'This runs in the background — the map appears when it completes.'
                : 'Generate to aggregate your routes into a density map for this region.'}
            </div>
          </div>
          {!busy && (
            <Button type="button" size="sm" onClick={onGenerate}>
              <Flame className="size-4" />
              Generate heatmap
            </Button>
          )}
        </div>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Generation tasks
          </h2>
          {heatmap && (
            <span className="text-[11px] text-muted-foreground">1 run</span>
          )}
        </div>
        {heatmap ? (
          <GenerationTaskRow
            heatmap={heatmap}
            progressPercent={progressPercent}
            currentTime={currentTime}
            isRetrying={isRetrying}
            onRetry={onRetry}
          />
        ) : generationQueued ? (
          <div className="flex items-center gap-1.5 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Route cache queued
          </div>
        ) : (
          <p className="py-3 text-xs text-muted-foreground">
            No generation runs yet for this region.
          </p>
        )}
      </section>
    </div>
  )
}
