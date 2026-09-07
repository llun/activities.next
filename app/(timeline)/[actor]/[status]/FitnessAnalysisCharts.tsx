import { type FC, type ReactNode, useMemo } from 'react'

import { cn } from '@/lib/utils'

import {
  GRAPH_VIEW_HEIGHT,
  type HeartRateZone,
  OVERVIEW_TICK_COUNT,
  buildChartAreaPath,
  buildChartPath,
  buildXAxisLabels,
  clampNumber,
  computeCombinedChartHighlights,
  formatChartValue,
  formatDuration,
  getSeriesMinMax,
  scaleCombinedChartSeries,
  shouldFlipChartReadout
} from './fitnessChartData'
import { useChartScrub } from './useChartScrub'

export type AnalysisGraphKey = 'elevation' | 'speed' | 'power' | 'heart-rate'

// How the selected graphs are drawn: `separate` stacks each into its own row of
// one bordered panel (the original behaviour); `combined` overlays them all in a
// single chart, each series scaled to its own range.
export type GraphDisplayMode = 'separate' | 'combined'

export const GRAPH_DISPLAY_MODES: Array<{
  id: GraphDisplayMode
  label: string
}> = [
  { id: 'separate', label: 'Separate' },
  { id: 'combined', label: 'Combined' }
]

// One toggle per series (no "all" pseudo-option): the graphs to show are picked
// as a multi-select, so "show everything" is simply every chip on — which is the
// default — rather than a distinct mode.
export const ANALYSIS_GRAPH_OPTIONS: Array<{
  id: AnalysisGraphKey
  label: string
}> = [
  { id: 'elevation', label: 'Elevation' },
  { id: 'speed', label: 'Speed' },
  { id: 'power', label: 'Power' },
  { id: 'heart-rate', label: 'Heart rate' }
]

// One colour per series, used for the line, the hover crosshair and the hover
// dot alike — so a stacked graph is identifiable by its own colour rather than
// every crosshair sharing the speed chart's blue. `chipBorder` tints a selected
// picker chip and the combined-chart legend with that same series colour.
export const ANALYSIS_GRAPH_STYLES: Record<
  AnalysisGraphKey,
  { stroke: string; dot: string; chipBorder: string }
> = {
  elevation: {
    stroke: 'stroke-slate-400',
    dot: 'bg-slate-400',
    chipBorder: 'border-slate-400'
  },
  speed: {
    stroke: 'stroke-sky-500',
    dot: 'bg-sky-500',
    chipBorder: 'border-sky-500'
  },
  power: {
    stroke: 'stroke-violet-500',
    dot: 'bg-violet-500',
    chipBorder: 'border-violet-500'
  },
  'heart-rate': {
    stroke: 'stroke-rose-500',
    dot: 'bg-rose-500',
    chipBorder: 'border-rose-500'
  }
}

export const GRAPH_HEIGHT_CLASSNAME = 'h-[190px] lg:h-[250px]'

export const Card: FC<{
  className?: string
  children: ReactNode
  padded?: boolean
}> = ({ className, children, padded = true }) => (
  <div
    className={cn(
      'rounded-xl border bg-card shadow-sm',
      padded && 'p-5',
      className
    )}
  >
    {children}
  </div>
)

export interface ChartHoverMarkerProps {
  x: number
  y: number
  width: number
  height: number
  value: number
  unit: string
  fractionDigits: number
  dotClassName?: string
}

// The dot pinned to the highlighted sample plus the value chip beside it,
// shared by every scrubbable chart so the two never drift apart.
export const ChartHoverMarker: FC<ChartHoverMarkerProps> = ({
  x,
  y,
  width,
  height,
  value,
  unit,
  fractionDigits,
  dotClassName
}) => {
  // The readout sits beside the dot and flips to its left near the right edge.
  // The threshold is a fraction of the viewBox while the chip is a fixed pixel
  // width, so the two only agree above some container width, and the binding
  // case is the narrowest host at the 320px reflow target.
  //
  // Derived for the Analysis stack, where the plot is 220px and the chip is
  // ~77px for the widest value those series realistically produce
  // ("13.5 km/h"), against a budget of that 220px plus the panel's own 16px
  // right padding: the design kit's 0.72 lands 12px past what will be shown,
  // anything at or below 0.66 fits, and 0.62 keeps a margin for a longer value
  // or a wider font — at the cost of flipping sooner than the kit does in a
  // desktop column, where there is still room to the right.
  //
  // Re-checked for the Overview elevation card, which is the other host and a
  // tighter one: a `Card` has no `overflow-hidden` to clip a chip that escapes,
  // and its plot is 212px rather than 220px. It is still safe, because its chip
  // is also smaller ("1234 m" is ~67px against that 77px), so the right edge
  // lands at 0.62 x 212 + 12 + 67 = 210px — inside the 212px plot, before
  // touching the card's 20px padding. Re-derive BOTH if this moves.
  const shouldFlipReadout = shouldFlipChartReadout(x, width)

  return (
    <>
      {/* The dot is HTML, not an SVG `circle`: `preserveAspectRatio="none"`
          scales x and y independently, so a circle renders as an ellipse that
          is half again as wide as it is tall in a desktop column and nearly
          twice as tall as wide on a phone. Positioned by the same percentage
          mapping as the readout — exact under that same `none`. */}
      <span
        aria-hidden="true"
        data-testid="chart-hover-dot"
        className={cn(
          'pointer-events-none absolute z-10 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
          dotClassName ?? 'bg-sky-500'
        )}
        style={{
          left: `${(x / width) * 100}%`,
          top: `${(y / height) * 100}%`
        }}
      />
      {/* Value readout pinned to the hover dot. Percentage positioning works
          because `preserveAspectRatio="none"` maps the viewBox linearly onto
          the rendered box; the vertical clamp keeps it inside the plot when
          the sample sits against the top or bottom of the scale.
          `aria-hidden` because it is the running commentary on a pointer
          gesture, which a screen reader would otherwise meet as a bare figure
          with no context, attached to a control it cannot drive. Note the
          Analysis panel also prints the same range in its "Scale …" header
          while the elevation card does not, so on that card the scrubbed
          value is genuinely pointer-only — the same gap the charts already
          have for a keyboard user, and a follow-up rather than something this
          chip should paper over with a live region.
          Keeping it inside the panel is the flip threshold's job, not a
          `max-width`'s — the chip is clipped by where it is positioned, and
          a cap wide enough to never truncate the text is also too wide to
          ever bind. */}
      <div
        aria-hidden="true"
        data-testid="chart-hover-value"
        className="pointer-events-none absolute z-20 flex items-baseline gap-1 rounded-md border bg-background px-2 py-1 shadow-sm"
        style={{
          left: `${(x / width) * 100}%`,
          top: `${clampNumber((y / height) * 100, 8, 92)}%`,
          transform: shouldFlipReadout
            ? 'translate(calc(-100% - 12px), -50%)'
            : 'translate(12px, -50%)'
        }}
      >
        <span className="text-sm font-semibold leading-none tabular-nums text-foreground">
          {formatChartValue(value, fractionDigits)}
        </span>
        <span className="text-[10px] leading-none text-muted-foreground">
          {unit}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 size-2 bg-background',
            shouldFlipReadout
              ? '-right-[4.5px] border-r border-t'
              : '-left-[4.5px] border-b border-l'
          )}
          style={{ transform: 'translateY(-50%) rotate(45deg)' }}
        />
      </div>
    </>
  )
}

export interface ElevationProfileChartProps {
  values: number[]
  height?: number
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}

// The Overview's filled elevation profile. Visually it is its own thing — the
// orange area fill under a heavier line, sized for a summary card — but it
// scrubs exactly like the Analysis stack does, off the same `useChartScrub`
// hook and the same shared marker, so dragging it reports the elevation under
// the pointer and moves the highlight on the map above it.
export const ElevationProfileChart: FC<ElevationProfileChartProps> = ({
  values,
  height = 130,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}) => {
  const width = 800
  const { minValue, maxValue } = useMemo(
    () => getSeriesMinMax(values),
    [values]
  )
  // Memoized because the series is now plotted at Strava's density: rebuilding
  // a path string of up to 1,200 points on every pointer move would be the one
  // expensive thing a scrub does.
  const line = useMemo(
    () => buildChartPath(values, width, height, minValue, maxValue),
    [values, height, minValue, maxValue]
  )
  const area = useMemo(
    () => buildChartAreaPath(line, width, height),
    [line, height, width]
  )
  // Four ticks, not the helper's default six. This card is narrower than the
  // Analysis panel (a `p-5` Card inside the same column, so 212px of content at
  // the 320px reflow target against that panel's 220px), `justify-between`
  // gives a label row no way to wrap, and a Card has no `overflow-hidden` to
  // clip a row that outgrows it the way that panel does — so an over-wide row
  // here runs its labels together into one unbroken string of digits and then
  // crosses the card's own border.
  //
  // Worked at 11px tabular-nums, where "0:00" is ~24px and one "H:MM:SS" label
  // ~42px (a five-hour ride, the point at which every tick but the first has
  // taken the wider form): six labels need 24 + 5x42 = 234px against 212px,
  // while four need 24 + 3x42 = 150px and keep ~20px between each. Going longer
  // adds little: `formatFitnessDuration` does not zero-pad the hour, so a
  // ten-hour ride widens only the labels that reach two digits (~49px) — 241px
  // at six ticks, a still-comfortable 157px at four. Pinned by a test, since
  // the failure is silent — nothing errors, the labels just merge.
  const xLabels = useMemo(
    () =>
      durationSeconds
        ? buildXAxisLabels(durationSeconds, OVERVIEW_TICK_COUNT)
        : null,
    [durationSeconds]
  )
  const scrub = useChartScrub({
    values,
    width,
    height,
    minValue,
    maxValue,
    durationSeconds,
    highlightedElapsedSeconds,
    onHighlightElapsedSeconds
  })

  return (
    <div data-testid="overview-elevation-profile">
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={cn('block h-full w-full', scrub.plotClassName)}
          {...scrub.plotHandlers}
        >
          <defs>
            <linearGradient
              id="fitness-elevation-gradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0" stopColor="hsl(24 95% 46%)" stopOpacity="0.28" />
              <stop offset="1" stopColor="hsl(24 95% 46%)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line
            x1={0}
            y1={height / 2}
            x2={width}
            y2={height / 2}
            className="stroke-border"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <path d={area} fill="url(#fitness-elevation-gradient)" />
          <path
            d={line}
            fill="none"
            className="stroke-primary"
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {scrub.highlight ? (
            <line
              x1={scrub.highlight.x}
              y1={0}
              x2={scrub.highlight.x}
              y2={height}
              vectorEffect="non-scaling-stroke"
              className="stroke-primary stroke-[1.5] opacity-60"
            />
          ) : null}
        </svg>
        {scrub.highlight ? (
          <ChartHoverMarker
            x={scrub.highlight.x}
            y={scrub.highlight.y}
            width={width}
            height={height}
            value={scrub.highlight.value}
            unit="m"
            fractionDigits={0}
            dotClassName="bg-primary"
          />
        ) : null}
      </div>
      {xLabels && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          {xLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export interface HeartRateZonesPanelProps {
  zones: HeartRateZone[]
}

export const HeartRateZonesPanel: FC<HeartRateZonesPanelProps> = ({
  zones
}) => {
  const formatZoneRange = (zone: HeartRateZone) => {
    if (zone.lo === 0 && zone.hi !== null) return `< ${zone.hi} bpm`
    if (zone.hi === null) return `${zone.lo}+ bpm`
    return `${zone.lo}–${zone.hi} bpm`
  }

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {zones.map((zone) => (
          // rawPct (unrounded sample share) keeps the stacked segments from
          // under/overflowing; pct is only for the displayed label.
          <div
            key={zone.name}
            title={`${zone.name} ${zone.pct}%`}
            style={{
              width: `${zone.rawPct}%`,
              background: zone.color
            }}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2.5">
        {zones.map((zone) => (
          <div key={zone.name} className="flex items-center gap-3">
            <span
              className="inline-block size-3 shrink-0 rounded-[3px]"
              style={{ background: zone.color }}
              aria-hidden="true"
            />
            <span className="w-7 shrink-0 text-sm font-semibold tabular-nums">
              {zone.name}
            </span>
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              {zone.label}
            </span>
            <span className="hidden w-24 shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
              {formatZoneRange(zone)}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${zone.rawPct}%`, background: zone.color }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
              {formatDuration(zone.seconds)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface ChartPanelProps {
  title: string
  unit: string
  strokeClassName?: string
  dotClassName?: string
  values: number[]
  minLabel?: string
  maxLabel?: string
  /**
   * Decimals the hover readout uses, kept the same as the scale labels' own
   * precision so the value doesn't switch width between integer and fractional
   * samples as the pointer moves.
   */
  fractionDigits?: number
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}

export const ChartPanel: FC<ChartPanelProps> = ({
  title,
  unit,
  values,
  strokeClassName,
  dotClassName,
  minLabel,
  maxLabel,
  fractionDigits = 0,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}) => {
  const width = 760
  const height = GRAPH_VIEW_HEIGHT
  const { minValue, maxValue } = useMemo(
    () => getSeriesMinMax(values),
    [values]
  )
  const path = useMemo(
    () => buildChartPath(values, width, height, minValue, maxValue),
    [maxValue, minValue, values]
  )
  const minScale = minLabel ? `${minLabel} ${unit}` : `-- ${unit}`
  const maxScale = maxLabel ? `${maxLabel} ${unit}` : `-- ${unit}`
  const xLabels = useMemo(
    () => (durationSeconds ? buildXAxisLabels(durationSeconds) : null),
    [durationSeconds]
  )
  const scrub = useChartScrub({
    values,
    width,
    height,
    minValue,
    maxValue,
    durationSeconds,
    highlightedElapsedSeconds,
    onHighlightElapsedSeconds
  })

  // No border or rounding of its own: every chart is a row of the one bordered
  // panel the Analysis section stacks them into, so a border here would draw a
  // second box inside it.
  return (
    <div className="bg-background p-4">
      <div className="mb-2 flex items-end justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs tabular-nums text-muted-foreground">
          Scale {minScale} - {maxScale}
        </p>
      </div>
      {/* The scale labels overlay the plot's top-left and bottom-left corners
          rather than taking a gutter column, so every stacked chart's plot
          starts and ends at the same x and the rows read as one table. They are
          inside the plot box only — the x-axis labels below sit outside it, so
          the minimum label cannot land on top of the first tick. */}
      <div className={cn('relative', GRAPH_HEIGHT_CLASSNAME)}>
        {/* Each label carries its own backdrop: in the gutter column these
            replaced there was nothing to collide with, but on the plot a series
            that starts at its minimum — speed, power and heart rate nearly
            always do — puts the first path point at exactly `y = height`, i.e.
            straight through the bottom-left label. Above the hover dot
            (`z-10`), which sits at the plot's left edge at the very first
            sample; still below the readout, which is the thing being read. */}
        <span className="pointer-events-none absolute left-0 top-0 z-20 rounded bg-background/95 px-1 text-[11px] tabular-nums text-muted-foreground">
          {maxScale}
        </span>
        <span className="pointer-events-none absolute bottom-0 left-0 z-20 rounded bg-background/95 px-1 text-[11px] tabular-nums text-muted-foreground">
          {minScale}
        </span>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={cn('block h-full w-full', scrub.plotClassName)}
          {...scrub.plotHandlers}
        >
          <path
            d={path}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className={cn('stroke-[2]', strokeClassName ?? 'stroke-sky-500')}
          />
          {scrub.highlight ? (
            <line
              x1={scrub.highlight.x}
              y1={0}
              x2={scrub.highlight.x}
              y2={height}
              vectorEffect="non-scaling-stroke"
              className={cn(
                'stroke-[1.5] opacity-60',
                strokeClassName ?? 'stroke-sky-500'
              )}
            />
          ) : null}
        </svg>
        {scrub.highlight ? (
          <ChartHoverMarker
            x={scrub.highlight.x}
            y={scrub.highlight.y}
            width={width}
            height={height}
            value={scrub.highlight.value}
            unit={unit}
            fractionDigits={fractionDigits}
            dotClassName={dotClassName}
          />
        ) : null}
      </div>
      {xLabels && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          {xLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export interface CombinedChartSeries {
  key: AnalysisGraphKey
  label: string
  unit: string
  values: number[]
  fractionDigits: number
}

export interface CombinedChartPanelProps {
  series: CombinedChartSeries[]
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}

// One chart that overlays several series, each scaled to its OWN range so a
// 0–55 m elevation trace and a 90–190 bpm heart-rate trace can share one plot
// without either flattening the other. It scrubs like the stacked `ChartPanel`
// — the same pointer→elapsed handlers move the map highlight above it — but
// draws one coloured line per series under a shared crosshair, and a single
// readout lists every series' value at the hovered instant.
export const CombinedChartPanel: FC<CombinedChartPanelProps> = ({
  series,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}) => {
  const width = 760
  const height = GRAPH_VIEW_HEIGHT

  // Each series carries its own min/max and its own path, so a shallow trace is
  // not squashed by a taller one sharing the plot. Memoized because the paths
  // run to Strava's density (up to 1,200 points each) and must not rebuild on a
  // pointer move.
  const plotted = useMemo(
    () => scaleCombinedChartSeries(series, width, height),
    [series]
  )

  // The scrub only turns a pointer x into an elapsed time, so drive it off the
  // longest series — a short or late-starting one would otherwise be the first
  // to run out of samples. Its own single-series `highlight` is ignored; the
  // per-series dots below are placed from each series' own projection instead.
  const scrubDriver = plotted.reduce<(typeof plotted)[number] | null>(
    (longest, entry) =>
      longest && longest.values.length >= entry.values.length ? longest : entry,
    null
  )
  const scrub = useChartScrub({
    values: scrubDriver?.values ?? [],
    width,
    height,
    minValue: scrubDriver?.minValue ?? 0,
    maxValue: scrubDriver?.maxValue ?? 0,
    durationSeconds,
    highlightedElapsedSeconds,
    onHighlightElapsedSeconds
  })

  const ratio =
    scrub.canScrub &&
    typeof highlightedElapsedSeconds === 'number' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0
      ? clampNumber(highlightedElapsedSeconds / durationSeconds, 0, 1)
      : null
  // The crosshair marks the shared time; each dot sits on its own line, at that
  // series' own sample for the instant.
  const crosshairX = ratio === null ? null : ratio * width
  const highlights = useMemo(
    () => computeCombinedChartHighlights(plotted, ratio, width, height),
    [plotted, ratio]
  )

  const xLabels = useMemo(
    () => (durationSeconds ? buildXAxisLabels(durationSeconds) : null),
    [durationSeconds]
  )

  // Flip the readout to the left of the crosshair near the right edge, on the
  // same fraction the single-series `ChartHoverMarker` uses so both charts agree.
  const shouldFlipReadout =
    crosshairX !== null && shouldFlipChartReadout(crosshairX, width)

  return (
    <div className="bg-background p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Combined</h3>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {series.map((entry) => (
            <span
              key={entry.key}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  ANALYSIS_GRAPH_STYLES[entry.key].dot
                )}
              />
              {entry.label}
            </span>
          ))}
        </div>
      </div>
      <div className={cn('relative', GRAPH_HEIGHT_CLASSNAME)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={cn('block h-full w-full', scrub.plotClassName)}
          {...scrub.plotHandlers}
        >
          {plotted.map((entry) => (
            <path
              key={entry.key}
              d={entry.path}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className={cn(
                'stroke-[2]',
                ANALYSIS_GRAPH_STYLES[entry.key].stroke
              )}
            />
          ))}
          {crosshairX !== null ? (
            <line
              x1={crosshairX}
              y1={0}
              x2={crosshairX}
              y2={height}
              vectorEffect="non-scaling-stroke"
              className="stroke-muted-foreground stroke-[1.5] opacity-50"
            />
          ) : null}
        </svg>
        {highlights.map((entry) => (
          <span
            key={entry.key}
            aria-hidden="true"
            data-testid="combined-hover-dot"
            className={cn(
              'pointer-events-none absolute z-10 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
              ANALYSIS_GRAPH_STYLES[entry.key].dot
            )}
            style={{
              left: `${(entry.x / width) * 100}%`,
              top: `${(entry.y / height) * 100}%`
            }}
          />
        ))}
        {/* One readout box for the whole chart rather than a chip per line: three
            overlapping single-value chips would collide. Pinned to the top so it
            never chases a dot across the other series' lines. */}
        {crosshairX !== null && highlights.length > 0 ? (
          <div
            aria-hidden="true"
            data-testid="combined-hover-value"
            className="pointer-events-none absolute top-2 z-20 flex flex-col gap-0.5 rounded-md border bg-background px-2 py-1 shadow-sm"
            style={{
              left: `${(crosshairX / width) * 100}%`,
              transform: shouldFlipReadout
                ? 'translateX(calc(-100% - 12px))'
                : 'translateX(12px)'
            }}
          >
            {highlights.map((entry) => (
              <div key={entry.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    ANALYSIS_GRAPH_STYLES[entry.key].dot
                  )}
                />
                <span className="text-xs font-semibold leading-none tabular-nums text-foreground">
                  {formatChartValue(entry.value, entry.fractionDigits)}
                </span>
                <span className="text-[10px] leading-none text-muted-foreground">
                  {entry.unit}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {xLabels && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          {xLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Each graph is scaled to its own range.
      </p>
    </div>
  )
}

export interface FitnessAnalysisChartsProps {
  activitySeries: {
    elevation: number[]
    speed: number[]
    power: number[]
    heartRate: number[]
  }
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
  graphDisplayMode: GraphDisplayMode
  onGraphDisplayModeChange: (mode: GraphDisplayMode) => void
  selectedGraphKeys: AnalysisGraphKey[]
  onToggleGraphKey: (key: AnalysisGraphKey) => void
  isRouteDataLoading?: boolean
  routeDataError?: string | null
}

export const FitnessAnalysisCharts: FC<FitnessAnalysisChartsProps> = ({
  activitySeries,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds,
  graphDisplayMode,
  onGraphDisplayModeChange,
  selectedGraphKeys,
  onToggleGraphKey,
  isRouteDataLoading = false,
  routeDataError = null
}) => {
  const { minValue: elevationMin, maxValue: elevationMax } = useMemo(
    () => getSeriesMinMax(activitySeries.elevation),
    [activitySeries.elevation]
  )
  const { minValue: speedMin, maxValue: speedMax } = useMemo(
    () => getSeriesMinMax(activitySeries.speed),
    [activitySeries.speed]
  )
  const { minValue: powerMin, maxValue: powerMax } = useMemo(
    () => getSeriesMinMax(activitySeries.power),
    [activitySeries.power]
  )
  const { minValue: heartRateMin, maxValue: heartRateMax } = useMemo(
    () => getSeriesMinMax(activitySeries.heartRate),
    [activitySeries.heartRate]
  )

  const highlightedElapsedLabel =
    typeof highlightedElapsedSeconds === 'number'
      ? formatDuration(Math.round(highlightedElapsedSeconds))
      : null

  // Every chart the Analysis section can draw, in display order. `fractionDigits`
  // is the precision of that series' scale labels, reused by the hover readout.
  const analysisCharts = useMemo(
    (): Array<{
      key: AnalysisGraphKey
      /** Long title for the stacked panel row ("Elevation profile"). */
      title: string
      /** Short label for the picker chip and combined-chart legend. */
      label: string
      unit: string
      values: number[]
      minLabel: string
      maxLabel: string
      fractionDigits: number
    }> => [
      {
        key: 'elevation',
        title: 'Elevation profile',
        label: 'Elevation',
        unit: 'm',
        values: activitySeries.elevation,
        minLabel: formatChartValue(elevationMin, 0),
        maxLabel: formatChartValue(elevationMax, 0),
        fractionDigits: 0
      },
      {
        key: 'speed',
        title: 'Speed',
        label: 'Speed',
        unit: 'km/h',
        values: activitySeries.speed,
        minLabel: formatChartValue(speedMin, 1),
        maxLabel: formatChartValue(speedMax, 1),
        fractionDigits: 1
      },
      {
        key: 'power',
        title: 'Power',
        label: 'Power',
        unit: 'w',
        values: activitySeries.power,
        minLabel: formatChartValue(powerMin, 0),
        maxLabel: formatChartValue(powerMax, 0),
        fractionDigits: 0
      },
      {
        key: 'heart-rate',
        title: 'Heart rate',
        label: 'Heart rate',
        unit: 'bpm',
        values: activitySeries.heartRate,
        minLabel: formatChartValue(heartRateMin, 0),
        maxLabel: formatChartValue(heartRateMax, 0),
        fractionDigits: 0
      }
    ],
    [
      activitySeries,
      elevationMax,
      elevationMin,
      heartRateMax,
      heartRateMin,
      powerMax,
      powerMin,
      speedMax,
      speedMin
    ]
  )

  // The charts to draw: those with data whose chip is on, kept in the fixed
  // display order of `analysisCharts` regardless of the order they were toggled.
  // Memoized (independent of the hovered instant) so the combined chart's paths
  // are not rebuilt on every pointer move.
  const visibleAnalysisCharts = useMemo(
    () =>
      analysisCharts.filter(
        (chart) =>
          chart.values.length > 0 && selectedGraphKeys.includes(chart.key)
      ),
    [analysisCharts, selectedGraphKeys]
  )

  const combinedChartSeries = useMemo<CombinedChartSeries[]>(
    () =>
      visibleAnalysisCharts.map((chart) => ({
        key: chart.key,
        label: chart.label,
        unit: chart.unit,
        values: chart.values,
        fractionDigits: chart.fractionDigits
      })),
    [visibleAnalysisCharts]
  )

  // The chips to offer — only series that actually have data. A chip the user
  // toggled off is simply dropped from `visibleAnalysisCharts`, and one whose
  // series is absent from the current file never appears here, so the picker
  // needs no reset effect to recover from an empty selection.
  const analysisGraphOptions = useMemo(() => {
    return ANALYSIS_GRAPH_OPTIONS.filter((option) => {
      if (option.id === 'elevation') return activitySeries.elevation.length > 0
      if (option.id === 'speed') return activitySeries.speed.length > 0
      if (option.id === 'power') return activitySeries.power.length > 0
      if (option.id === 'heart-rate') return activitySeries.heartRate.length > 0
      return true
    })
  }, [activitySeries])

  const hasAnalysisSeries =
    activitySeries.elevation.length > 0 ||
    activitySeries.speed.length > 0 ||
    activitySeries.power.length > 0 ||
    activitySeries.heartRate.length > 0

  if (!hasAnalysisSeries) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          {isRouteDataLoading
            ? 'Loading analysis data…'
            : (routeDataError ??
              'No analysis data is available for this activity.')}
        </p>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Graph display
          </p>
          {/* Segmented toggle: `separate` stacks each graph, `combined`
              overlays them in one chart. */}
          <div
            role="group"
            aria-label="Graph display mode"
            className="inline-flex rounded-lg border bg-muted p-0.5 text-xs font-medium"
          >
            {GRAPH_DISPLAY_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={graphDisplayMode === mode.id}
                onClick={() => onGraphDisplayModeChange(mode.id)}
                className={cn(
                  'rounded-md px-3 py-1 transition-colors',
                  graphDisplayMode === mode.id
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {analysisGraphOptions.map((option) => {
            const isSelected = selectedGraphKeys.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onToggleGraphKey(option.id)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  isSelected
                    ? cn(
                        ANALYSIS_GRAPH_STYLES[option.id].chipBorder,
                        'text-foreground'
                      )
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    ANALYSIS_GRAPH_STYLES[option.id].dot,
                    !isSelected && 'opacity-40'
                  )}
                />
                {option.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {highlightedElapsedLabel
            ? `Selected time: ${highlightedElapsedLabel}`
            : graphDisplayMode === 'combined'
              ? 'Pick the graphs to overlay in one chart. Hover it to follow that time point on the map.'
              : 'Pick the graphs to show. Hover any graph to follow that time point on the map.'}
        </p>
      </Card>

      {/* No chip is on — every graph was toggled off — so there is
          nothing to draw in either mode. */}
      {visibleAnalysisCharts.length === 0 && (
        <Card>
          <p className="text-sm text-muted-foreground">
            Select at least one graph to display.
          </p>
        </Card>
      )}

      {/* Combined: every selected series overlaid in one chart, each
          scaled to its own range. */}
      {graphDisplayMode === 'combined' && combinedChartSeries.length > 0 && (
        <div
          data-testid="analysis-combined-graph"
          className="overflow-hidden rounded-xl border bg-background"
        >
          <CombinedChartPanel
            series={combinedChartSeries}
            durationSeconds={durationSeconds}
            highlightedElapsedSeconds={highlightedElapsedSeconds}
            onHighlightElapsedSeconds={onHighlightElapsedSeconds}
          />
        </div>
      )}

      {/* Separate: every visible graph shares ONE bordered panel, its rows
          split by a 1px divider and nothing else — so a full selection
          reads as a single table of time-aligned series rather than four
          cards with gaps between them. */}
      {graphDisplayMode === 'separate' && visibleAnalysisCharts.length > 0 && (
        <div
          data-testid="analysis-graphs"
          className="overflow-hidden rounded-xl border bg-background"
        >
          {visibleAnalysisCharts.map((chart, index) => (
            <div key={chart.key} className={cn(index > 0 && 'border-t')}>
              <ChartPanel
                title={chart.title}
                unit={chart.unit}
                values={chart.values}
                strokeClassName={ANALYSIS_GRAPH_STYLES[chart.key].stroke}
                dotClassName={ANALYSIS_GRAPH_STYLES[chart.key].dot}
                minLabel={chart.minLabel}
                maxLabel={chart.maxLabel}
                fractionDigits={chart.fractionDigits}
                durationSeconds={durationSeconds}
                highlightedElapsedSeconds={highlightedElapsedSeconds}
                onHighlightElapsedSeconds={onHighlightElapsedSeconds}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
