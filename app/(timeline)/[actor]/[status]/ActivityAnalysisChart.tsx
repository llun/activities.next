'use client'

import {
  type FC,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { MediaStripEdges } from '@/lib/components/posts/MediaStripEdges'
import { useMediaStripScroll } from '@/lib/components/posts/useMediaStripScroll'
import { Frame } from '@/lib/components/surface/Frame'
import { cn } from '@/lib/utils'

import {
  ANALYSIS_GRAPH_STYLES,
  ChartTimeLabels,
  type GraphDisplayMode
} from './FitnessAnalysisCharts'
import type { AnalysisSeries } from './activityAnalysis'
import {
  type ActivitySplit,
  type ChartTimeAxis,
  toChartSeconds,
  toElapsedSeconds
} from './fitnessActivityMetrics'
import {
  buildGappedChartPaths,
  buildXAxisLabels,
  clampNumber,
  formatChartValue,
  formatDuration
} from './fitnessChartData'
import { useChartScrub } from './useChartScrub'

// Every plot is drawn in one 1000×100 viewBox stretched to its box
// (`preserveAspectRatio="none"`), with non-scaling strokes, so the combined
// chart and each separate row share one x scale: chart time over the width,
// which is elapsed time with the pauses cut short (`ChartTimeAxis`).
const VIEW_WIDTH = 1000
const VIEW_HEIGHT = 100
const TIME_LABEL_COUNT = 5
// Gaps between the crosshair and the readout on either side of it, in px.
const READOUT_GAP_RIGHT = 10
const READOUT_GAP_LEFT = 8

/**
 * Where the combined chart's readout goes, as its left edge in px within the
 * plot: right of the crosshair when it fits there, else left of it, and when
 * the plot is too narrow for either (a phone with several series shown),
 * centred on the crosshair and clamped inside the plot, so it never runs out
 * past the chart's edge.
 */
export const placeReadout = (
  cursorX: number,
  plotWidth: number,
  readoutWidth: number
): number => {
  const right = cursorX + READOUT_GAP_RIGHT
  if (right + readoutWidth <= plotWidth) return right
  const left = cursorX - READOUT_GAP_LEFT - readoutWidth
  if (left >= 0) return left
  return clampNumber(
    cursorX - readoutWidth / 2,
    0,
    Math.max(0, plotWidth - readoutWidth)
  )
}

export interface ActivityAnalysisChartProps {
  /** The selected series, in picker order. */
  series: AnalysisSeries[]
  mode: GraphDisplayMode
  durationSeconds: number
  /** The time axis the series were binned on; elapsed time when absent. */
  chartAxis?: ChartTimeAxis
  laps: ActivitySplit[]
  climbs: ActivitySplit[]
  /** The selected lap or climb (`ActivitySplit.key`), if any. */
  selectedKey: string | null
  onToggleSplit: (key: string) => void
  highlightedElapsedSeconds: number | null
  onHighlightElapsedSeconds: (elapsedSeconds: number | null) => void
  /** Where the activity was at a time, for the readout: "11.6 km · lap 3". */
  describePosition: (elapsedSeconds: number) => string | null
}

const formatSeriesValue = (entry: AnalysisSeries, value: number | null) =>
  value === null
    ? '–'
    : `${formatChartValue(value, entry.fractionDigits)} ${entry.unit}`

// The bin under a point on the time axis: bin i spans [i/N, (i+1)/N) of the
// width and is drawn at its centre (see `buildGappedChartPaths`), so the value
// read out is the one drawn under the cursor.
const valueAt = (entry: AnalysisSeries, ratio: number | null) => {
  if (ratio === null || entry.values.length === 0) return null
  const index = clampNumber(
    Math.floor(ratio * entry.values.length),
    0,
    entry.values.length - 1
  )
  return entry.values[index] ?? null
}

const LapsBand: FC<{
  laps: ActivitySplit[]
  selectedKey: string | null
  onToggle: (key: string) => void
}> = ({ laps, selectedKey, onToggle }) => {
  const strip = useMediaStripScroll(laps.map((lap) => lap.key).join(','))
  return (
    <div className="relative border-b bg-muted/40">
      <div
        ref={strip.ref}
        onScroll={strip.measure}
        role="group"
        aria-label="Laps"
        className="no-scrollbar flex snap-x snap-proximity scroll-pl-4 gap-1 overflow-x-auto px-4 py-2"
      >
        {laps.map((lap) => {
          const details = [
            lap.avgPower !== null ? `${Math.round(lap.avgPower)} W` : null,
            lap.avgHeartRate !== null
              ? `${Math.round(lap.avgHeartRate)} bpm`
              : null
          ].filter(Boolean)
          if (details.length === 0 && lap.distanceMeters !== null) {
            details.push(`${(lap.distanceMeters / 1000).toFixed(1)} km`)
          }
          const isSelected = selectedKey === lap.key
          return (
            <button
              key={lap.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(lap.key)}
              className={cn(
                // Every lap box is the same width: they share the band equally
                // and scroll once they reach the minimum.
                'min-w-36 flex-1 basis-0 snap-start overflow-hidden whitespace-nowrap rounded-md border px-2 py-1 text-left text-[11px] leading-snug tabular-nums text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isSelected
                  ? 'border-primary bg-primary/10'
                  : 'bg-background hover:bg-muted'
              )}
            >
              <span className="block text-xs font-semibold text-foreground">
                {lap.label} · {formatDuration(lap.durationSeconds)}
              </span>
              {details.join(' · ')}
            </button>
          )
        })}
      </div>
      {strip.canScrollLeft || strip.canScrollRight ? (
        <MediaStripEdges
          canScrollLeft={strip.canScrollLeft}
          canScrollRight={strip.canScrollRight}
          onScrollByPage={strip.scrollByPage}
          itemsLabel="laps"
          size="small"
          fadeClassName="from-muted"
        />
      ) : null}
    </div>
  )
}

const PlotBackdrop: FC<{
  axis: ChartTimeAxis
  gridLines: number[]
  laps: ActivitySplit[]
  climbs: ActivitySplit[]
  selected: ActivitySplit | null
}> = ({ axis, gridLines, laps, climbs, selected }) => {
  const toX = (elapsedSeconds: number) =>
    clampNumber(
      toChartSeconds(axis, elapsedSeconds) / axis.durationSeconds,
      0,
      1
    ) * VIEW_WIDTH
  return (
    <>
      {gridLines.map((y) => (
        <line
          key={`grid-${y}`}
          x1={0}
          x2={VIEW_WIDTH}
          y1={y}
          y2={y}
          className="stroke-border"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {climbs.map((climb) => (
        <rect
          key={climb.key}
          data-testid="chart-climb"
          x={toX(climb.startSeconds)}
          y={0}
          width={Math.max(0, toX(climb.endSeconds) - toX(climb.startSeconds))}
          height={VIEW_HEIGHT}
          className="fill-foreground"
          fillOpacity={0.04}
        />
      ))}
      {selected ? (
        <rect
          data-testid="chart-selected-range"
          x={toX(selected.startSeconds)}
          y={0}
          width={Math.max(
            0,
            toX(selected.endSeconds) - toX(selected.startSeconds)
          )}
          height={VIEW_HEIGHT}
          className="fill-primary"
          fillOpacity={0.12}
        />
      ) : null}
      {laps.slice(1).map((lap) => (
        <line
          key={lap.key}
          x1={toX(lap.startSeconds)}
          x2={toX(lap.startSeconds)}
          y1={0}
          y2={VIEW_HEIGHT}
          className="stroke-foreground"
          strokeOpacity={0.16}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
}

const SeriesPath: FC<{
  entry: AnalysisSeries
  areaOpacity: number
  strokeWidth: number
}> = ({ entry, areaOpacity, strokeWidth }) => {
  const paths = useMemo(
    () =>
      buildGappedChartPaths(
        entry.values,
        entry.scale.min,
        entry.scale.max,
        VIEW_WIDTH,
        VIEW_HEIGHT
      ),
    [entry]
  )
  const colours = ANALYSIS_GRAPH_STYLES[entry.key]
  return (
    <g data-testid={`chart-series-${entry.key}`}>
      {areaOpacity > 0 ? (
        <path
          d={paths.area}
          className={colours.fill}
          fillOpacity={areaOpacity}
        />
      ) : null}
      <path
        d={paths.line}
        fill="none"
        className={colours.stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

/**
 * The Analysis chart frame: the lap band along its top edge, then either one
 * combined chart (every selected series overlaid, each on its own scale) or a
 * row per series on a shared time axis. Hovering or dragging any plot moves
 * one crosshair across all of them and the marker on the route map; a lap or
 * climb picked here or in the tables is shaded on every plot.
 */
export const ActivityAnalysisChart: FC<ActivityAnalysisChartProps> = ({
  series,
  mode,
  durationSeconds,
  chartAxis,
  laps,
  climbs,
  selectedKey,
  onToggleSplit,
  highlightedElapsedSeconds,
  onHighlightElapsedSeconds,
  describePosition
}) => {
  const axis = useMemo(
    () => chartAxis ?? { durationSeconds, pauses: [] },
    [chartAxis, durationSeconds]
  )
  const scrub = useChartScrub({
    durationSeconds: axis.durationSeconds,
    toElapsedSeconds: (axisSeconds) => toElapsedSeconds(axis, axisSeconds),
    onHighlightElapsedSeconds
  })
  // The readout is placed from measured widths (see `placeReadout`), taken
  // before paint so it never shows in the wrong place first.
  const combinedPlotRef = useRef<HTMLDivElement | null>(null)
  const readoutRef = useRef<HTMLDivElement | null>(null)
  const [readoutSize, setReadoutSize] = useState<{
    plot: number
    readout: number
  } | null>(null)
  useLayoutEffect(() => {
    const plotWidth = combinedPlotRef.current?.clientWidth ?? 0
    const readoutWidth = readoutRef.current?.offsetWidth ?? 0
    const next =
      plotWidth > 0 && readoutWidth > 0
        ? { plot: plotWidth, readout: readoutWidth }
        : null
    setReadoutSize((current) =>
      current?.plot === next?.plot && current?.readout === next?.readout
        ? current
        : next
    )
  })
  const highlightedChartSeconds =
    typeof highlightedElapsedSeconds === 'number'
      ? toChartSeconds(axis, highlightedElapsedSeconds)
      : null
  const ratio =
    highlightedChartSeconds !== null && axis.durationSeconds > 0
      ? clampNumber(highlightedChartSeconds / axis.durationSeconds, 0, 1)
      : null
  const selected =
    [...laps, ...climbs].find((split) => split.key === selectedKey) ?? null
  const timeLabels = useMemo(
    () => buildXAxisLabels(axis.durationSeconds, TIME_LABEL_COUNT),
    [axis.durationSeconds]
  )
  const position =
    typeof highlightedElapsedSeconds === 'number'
      ? describePosition(highlightedElapsedSeconds)
      : null
  // On the axis's clock, so the readout matches the time labels under it.
  const timeLabel =
    highlightedChartSeconds !== null
      ? formatDuration(Math.round(highlightedChartSeconds))
      : null
  const statusText = selected
    ? `${selected.label} selected · click again to clear`
    : mode === 'combined'
      ? climbs.length > 0
        ? 'Scale per graph · shaded: climbs'
        : 'Scale per graph'
      : climbs.length > 0
        ? 'Shaded: climbs'
        : null

  const cursor =
    ratio !== null ? (
      <line
        x1={ratio * VIEW_WIDTH}
        x2={ratio * VIEW_WIDTH}
        y1={0}
        y2={VIEW_HEIGHT}
        className="stroke-foreground"
        strokeOpacity={0.5}
        vectorEffect="non-scaling-stroke"
      />
    ) : null

  const plot = (gridLines: number[], content: ReactNode, label: string) => (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-full w-full overflow-visible"
    >
      <PlotBackdrop
        axis={axis}
        gridLines={gridLines}
        laps={laps}
        climbs={climbs}
        selected={selected}
      />
      {content}
      {cursor}
    </svg>
  )

  return (
    <Frame className="overflow-hidden">
      {laps.length > 0 ? (
        <LapsBand
          laps={laps}
          selectedKey={selectedKey}
          onToggle={onToggleSplit}
        />
      ) : null}

      {series.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Select at least one graph to display.
        </p>
      ) : mode === 'combined' ? (
        <div className="space-y-2 px-4 pb-2.5 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Combined</h3>
            {statusText ? (
              <span className="text-xs text-muted-foreground">
                {statusText}
              </span>
            ) : null}
          </div>
          <div
            ref={combinedPlotRef}
            data-testid="analysis-combined-plot"
            className={cn(
              'relative h-[190px] select-none @min-[700px]:h-[250px]',
              scrub.plotClassName
            )}
            {...scrub.plotHandlers}
          >
            {plot(
              [25, 50, 75],
              series.map((entry) => (
                <SeriesPath
                  key={entry.key}
                  entry={entry}
                  areaOpacity={entry.key === 'elevation' ? 0.18 : 0}
                  strokeWidth={entry.key === 'elevation' ? 1 : 1.5}
                />
              )),
              `Combined chart: ${series.map((entry) => entry.label).join(', ')}`
            )}
            {ratio !== null && timeLabel ? (
              <div
                ref={readoutRef}
                aria-hidden="true"
                data-testid="analysis-readout"
                className="pointer-events-none absolute top-1 z-10 grid min-w-[140px] gap-px whitespace-nowrap rounded-md border bg-background px-2 py-1 text-xs tabular-nums shadow-sm"
                style={
                  readoutSize
                    ? {
                        left: `${placeReadout(
                          ratio * readoutSize.plot,
                          readoutSize.plot,
                          readoutSize.readout
                        )}px`
                      }
                    : // Not measured yet (the first layout pass): right of
                      // the crosshair, corrected before paint.
                      {
                        left: `${ratio * 100}%`,
                        transform: `translateX(${READOUT_GAP_RIGHT}px)`
                      }
                }
              >
                <div className="flex items-center justify-between gap-2.5">
                  <span className="text-muted-foreground">{timeLabel}</span>
                  {position ? (
                    <span className="font-semibold">{position}</span>
                  ) : null}
                </div>
                {series.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-center justify-between gap-2.5"
                  >
                    <span className="flex items-center gap-1">
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          ANALYSIS_GRAPH_STYLES[entry.key].dot
                        )}
                      />
                      {entry.label}
                    </span>
                    <span className="font-semibold">
                      {formatSeriesValue(entry, valueAt(entry, ratio))}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <ChartTimeLabels labels={timeLabels} dropPenultimateWhenNarrow />
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-2.5">
            {/* The scrubbed instant sits beside the heading, not in it, and is
                hidden from screen readers like the combined readout: it
                changes on every pointer move, and a heading that renamed
                itself that often would be read out again each time. */}
            <div className="flex items-baseline gap-1.5">
              <h3 className="text-sm font-semibold">Separate</h3>
              {timeLabel ? (
                <span
                  aria-hidden="true"
                  data-testid="analysis-separate-instant"
                  className="text-xs font-medium text-muted-foreground tabular-nums"
                >
                  {[timeLabel, position].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
            {statusText ? (
              <span className="text-xs text-muted-foreground">
                {statusText}
              </span>
            ) : null}
          </div>
          {series.map((entry, index) => (
            <div
              key={entry.key}
              data-testid={`analysis-row-${entry.key}`}
              className={cn(
                'space-y-1 px-4 pb-2 pt-2.5',
                index > 0 && 'border-t'
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 self-center rounded-full',
                    ANALYSIS_GRAPH_STYLES[entry.key].dot
                  )}
                />
                <h4 className="font-semibold">{entry.label}</h4>
                <span className="text-xs text-muted-foreground tabular-nums @max-[520px]:order-3 @max-[520px]:basis-full">
                  Scale{' '}
                  {formatChartValue(entry.scale.min, entry.fractionDigits)} –{' '}
                  {formatChartValue(entry.scale.max, entry.fractionDigits)}{' '}
                  {entry.unit}
                </span>
                <span className="ml-auto font-semibold tabular-nums">
                  {ratio !== null
                    ? formatSeriesValue(entry, valueAt(entry, ratio))
                    : null}
                </span>
              </div>
              <div
                className={cn(
                  'relative h-[92px] select-none @min-[700px]:h-[110px]',
                  scrub.plotClassName
                )}
                {...scrub.plotHandlers}
              >
                {plot(
                  [50],
                  <SeriesPath
                    entry={entry}
                    areaOpacity={0.12}
                    strokeWidth={1.5}
                  />,
                  `${entry.label} chart`
                )}
              </div>
            </div>
          ))}
          <div className="px-4 pb-2.5 pt-1">
            <ChartTimeLabels labels={timeLabels} dropPenultimateWhenNarrow />
          </div>
        </div>
      )}
    </Frame>
  )
}
