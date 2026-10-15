import { type FC } from 'react'

import {
  ANALYSIS_SERIES_COLOURS,
  type AnalysisSeriesKey
} from '@/lib/components/fitness/palette'
import { Frame } from '@/lib/components/surface/Frame'
import { cn } from '@/lib/utils'

import { type HeartRateZone, formatDuration } from './fitnessChartData'

export type AnalysisGraphKey = AnalysisSeriesKey

// How the selected graphs are drawn: `separate` stacks each into its own row of
// one chart frame; `combined` overlays them all in a single chart, each series
// scaled to its own range.
export type GraphDisplayMode = 'separate' | 'combined'

export const GRAPH_DISPLAY_MODES: Array<{
  id: GraphDisplayMode
  label: string
}> = [
  { id: 'separate', label: 'Separate' },
  { id: 'combined', label: 'Combined' }
]

// One colour per series lives in `lib/components/fitness/palette.ts` (a data
// palette the surface guard skips); `chipBorder` tints a selected picker chip
// with that same series colour.
export const ANALYSIS_GRAPH_STYLES = ANALYSIS_SERIES_COLOURS

// The time labels under a plot. `buildXAxisLabels` returns labels at equal
// fractions of the activity, so each one is placed at its own fraction of the
// plot's width: the first flush left, the last flush right (a label centred on
// either end would hang out of the frame) and the rest centred on their
// fraction. `justify-between` spread the label boxes evenly instead, which only
// puts a label under its time when every box is the same width — "0:00" and
// "1:13:46" are not, so the middle labels drifted by up to ~20px.
//
// Placing labels at their fractions costs the even gaps: the flush-right last
// label sits half its width inside its own fraction, so with five or more
// labels the one before it collides once the plot is under ~315px for
// "H:MM:SS" labels. `dropPenultimateWhenNarrow` hides that one label below
// 400px, measured on the label row itself (a container query, never the
// viewport: the plot can be narrow in a wide window).
export const ChartTimeLabels: FC<{
  labels: string[]
  dropPenultimateWhenNarrow?: boolean
  className?: string
}> = ({ labels, dropPenultimateWhenNarrow = false, className }) => {
  const lastIndex = labels.length - 1
  return (
    <div
      className={cn(
        '@container relative h-4 text-xs leading-4 tabular-nums text-muted-foreground',
        className
      )}
    >
      {labels.map((label, index) => {
        const isFirst = index === 0
        const isLast = index === lastIndex
        const isDroppedWhenNarrow =
          dropPenultimateWhenNarrow && lastIndex > 1 && index === lastIndex - 1
        return (
          <span
            key={index}
            data-testid="chart-time-label"
            className={cn(
              'absolute whitespace-nowrap',
              isFirst && 'left-0',
              !isFirst && isLast && 'right-0',
              !isFirst && !isLast && '-translate-x-1/2',
              isDroppedWhenNarrow && 'hidden @min-[400px]:block'
            )}
            style={
              isFirst || isLast
                ? undefined
                : { left: `${(index / lastIndex) * 100}%` }
            }
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

export interface GraphDisplayCardProps {
  mode: GraphDisplayMode
  onModeChange: (mode: GraphDisplayMode) => void
  /** The series the file has, in picker order. */
  options: Array<{ key: AnalysisGraphKey; label: string }>
  selectedKeys: AnalysisGraphKey[]
  onToggle: (key: AnalysisGraphKey) => void
  hint: string
}

/**
 * The "Graph display" card: the Separate/Combined switch and one chip per
 * series. A chip is a toggle; a selected chip takes its series colour.
 */
export const GraphDisplayCard: FC<GraphDisplayCardProps> = ({
  mode,
  onModeChange,
  options,
  selectedKeys,
  onToggle,
  hint
}) => (
  <Frame className="space-y-2.5 bg-card px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Graph display
      </p>
      <div
        role="group"
        aria-label="Graph display mode"
        className="inline-flex rounded-lg border bg-muted p-0.5 text-xs font-medium"
      >
        {GRAPH_DISPLAY_MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={mode === entry.id}
            onClick={() => onModeChange(entry.id)}
            className={cn(
              'rounded-md px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              mode === entry.id
                ? 'bg-background text-primary-text shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selectedKeys.includes(option.key)
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(option.key)}
            className={cn(
              'flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              isSelected
                ? cn(
                    ANALYSIS_GRAPH_STYLES[option.key].chipBorder,
                    'text-foreground'
                  )
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                ANALYSIS_GRAPH_STYLES[option.key].dot,
                !isSelected && 'opacity-40'
              )}
            />
            {option.label}
          </button>
        )
      })}
    </div>
    <p className="text-xs text-muted-foreground">{hint}</p>
  </Frame>
)

export interface HeartRateZonesPanelProps {
  zones: HeartRateZone[]
}

const formatZoneRange = (zone: HeartRateZone) => {
  if (zone.lo === 0 && zone.hi !== null) return `< ${zone.hi} bpm`
  if (zone.hi === null) return `${zone.lo}+ bpm`
  return `${zone.lo}–${zone.hi} bpm`
}

/**
 * Time in each heart-rate zone: the stacked share bar, then one row per zone
 * with its name, range and time over a bar scaled to the zone with the most
 * time. Laid out on a grid so it fits a third of a desktop column.
 */
export const HeartRateZonesPanel: FC<HeartRateZonesPanelProps> = ({
  zones
}) => {
  const longest = Math.max(1, ...zones.map((zone) => zone.seconds))
  return (
    <div className="space-y-2.5">
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
        {zones.map((zone) => (
          // rawPct (unrounded sample share) keeps the stacked segments from
          // under/overflowing; pct is only for the displayed label.
          <div
            key={zone.name}
            title={`${zone.name} ${zone.pct}%`}
            style={{ width: `${zone.rawPct}%`, background: zone.color }}
          />
        ))}
      </div>
      <ul className="space-y-2">
        {zones.map((zone) => (
          <li
            key={zone.name}
            className="grid grid-cols-[12px_22px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs tabular-nums"
          >
            <span
              className="size-3 rounded-[3px]"
              style={{ background: zone.color }}
              aria-hidden="true"
            />
            <span className="font-semibold">{zone.name}</span>
            <span className="flex min-w-0 justify-between gap-1.5 text-muted-foreground">
              <span className="truncate">{zone.label}</span>
              <span className="whitespace-nowrap">{formatZoneRange(zone)}</span>
            </span>
            <span className="min-w-10 text-right font-medium">
              {formatDuration(zone.seconds)}
            </span>
            <span
              aria-hidden="true"
              className="col-span-2 col-start-3 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(zone.seconds / longest) * 100}%`,
                  background: zone.color
                }}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
