import { BarChart3, HeartPulse, TrendingUp } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { ANALYSIS_SERIES_COLOURS } from '@/lib/components/fitness/palette'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { cn } from '@/lib/utils'

import { formatEffortDuration } from './ActivityBestEfforts'
import { HeartRateZonesPanel } from './FitnessAnalysisCharts'
import type { PowerDistribution, PowerEffort } from './fitnessActivityMetrics'
import {
  type HeartRateStats,
  type HeartRateZone,
  formatDuration
} from './fitnessChartData'

const VIEW_WIDTH = 300
const VIEW_HEIGHT = 100

/**
 * A small chart: y labels in a column on the left, the plot beside them, and
 * the x labels under the plot (in the plot's own column, so they line up with
 * it whatever width the y labels take).
 */
const MiniChart: FC<{
  yLabels: [string, string, string]
  xAxis: ReactNode
  children: ReactNode
  label: string
}> = ({ yLabels, xAxis, children, label }) => (
  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-2">
    <div
      aria-hidden="true"
      className="flex h-[120px] flex-col justify-between text-right text-[11px] leading-none tabular-nums text-muted-foreground"
    >
      {yLabels.map((text, index) => (
        <span key={index}>{text}</span>
      ))}
    </div>
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-[120px] w-full overflow-visible"
    >
      {children}
    </svg>
    <span aria-hidden="true" />
    <div className="relative h-4 text-xs tabular-nums text-muted-foreground">
      {xAxis}
    </div>
  </div>
)

const PowerDistributionChart: FC<{
  distribution: PowerDistribution
  avgPower: number | null
}> = ({ distribution, avgPower }) => {
  const { bins, isLastOpenEnded } = distribution
  const longest = Math.max(...bins.map((bin) => bin.minutes), 1 / 60)
  const barWidth = VIEW_WIDTH / bins.length
  const firstWatts = bins[0].fromWatts
  const spanWatts = bins.length * 25
  const averageX =
    avgPower !== null
      ? Math.max(
          0,
          Math.min(
            VIEW_WIDTH,
            ((avgPower - firstWatts) / spanWatts) * VIEW_WIDTH
          )
        )
      : null
  const binLabel = (index: number) => {
    const bin = bins[index]
    const isLast = index === bins.length - 1
    return isLast && isLastOpenEnded ? `${bin.fromWatts}+` : `${bin.fromWatts}`
  }
  // Five labels across the axis, the first with its unit.
  const tickIndices = Array.from(
    new Set(
      [0, 1, 2, 3, 4].map((step) => Math.round((step / 4) * (bins.length - 1)))
    )
  )

  return (
    <>
      <MiniChart
        yLabels={[
          formatDuration(Math.round(longest * 60)),
          formatDuration(Math.round((longest * 60) / 2)),
          '0s'
        ]}
        label="Time in 25 W bins"
        xAxis={tickIndices.map((index, position) => {
          const isFirst = position === 0
          const isLast = position === tickIndices.length - 1
          return (
            <span
              key={index}
              data-testid="power-x-tick"
              className={cn(
                'absolute whitespace-nowrap',
                isFirst && 'left-0',
                isLast && !isFirst && 'right-0',
                !isFirst && !isLast && '-translate-x-1/2'
              )}
              style={
                isFirst || isLast
                  ? undefined
                  : { left: `${((index + 0.5) / bins.length) * 100}%` }
              }
            >
              {isFirst ? `${binLabel(index)} W` : binLabel(index)}
            </span>
          )
        })}
      >
        {bins.map((bin, index) => {
          const height = (bin.minutes / longest) * VIEW_HEIGHT
          return (
            <rect
              key={bin.fromWatts}
              x={index * barWidth + 1}
              y={VIEW_HEIGHT - height}
              width={Math.max(0.5, barWidth - 2)}
              height={height}
              rx={1}
              className={ANALYSIS_SERIES_COLOURS.power.fill}
              fillOpacity={0.55}
            >
              <title>
                {`${binLabel(index)} W · ${formatDuration(Math.round(bin.minutes * 60))}`}
              </title>
            </rect>
          )
        })}
        {averageX !== null ? (
          <line
            data-testid="power-average-line"
            x1={averageX}
            x2={averageX}
            y1={8}
            y2={VIEW_HEIGHT}
            className="stroke-primary"
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </MiniChart>
      {avgPower !== null ? (
        <p className="text-xs text-primary-text">
          Dashed: average power {Math.round(avgPower)} W
        </p>
      ) : null}
    </>
  )
}

const POWER_CURVE_TICKS: Array<[number, string]> = [
  [60, '1 min'],
  [300, '5 min'],
  [1200, '20 min']
]

const PowerCurveChart: FC<{ curve: PowerEffort[] }> = ({ curve }) => {
  const last = curve[curve.length - 1].durationSeconds
  const top = Math.max(50, Math.ceil(curve[0].watts / 50) * 50)
  const logLast = Math.log(Math.max(2, last))
  const toX = (seconds: number) => (Math.log(seconds) / logLast) * VIEW_WIDTH
  const toY = (watts: number) => VIEW_HEIGHT - (watts / top) * VIEW_HEIGHT
  const line = curve
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${toX(point.durationSeconds).toFixed(1)} ${toY(point.watts).toFixed(1)}`
    )
    .join('')
  const area = `${line}L${toX(last).toFixed(1)} ${VIEW_HEIGHT}L0 ${VIEW_HEIGHT}Z`
  const gridStep = top / 4
  // Ticks that sit clear of both ends (the end label is right-aligned).
  const ticks = POWER_CURVE_TICKS.filter(
    ([seconds]) => seconds < last && toX(seconds) / VIEW_WIDTH < 0.85
  )
  const hint = [300, 1200]
    .map((seconds) => curve.find((point) => point.durationSeconds === seconds))
    .filter((point): point is PowerEffort => Boolean(point))
    .map(
      (point) =>
        `${formatEffortDuration(point.durationSeconds)} ${point.watts} W`
    )
    .join(' · ')

  return (
    <>
      <MiniChart
        yLabels={[`${top} W`, `${top / 2}`, '0']}
        label="Power curve"
        xAxis={
          <>
            <span className="absolute left-0">1 s</span>
            {ticks.map(([seconds, text]) => (
              <span
                key={seconds}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${(toX(seconds) / VIEW_WIDTH) * 100}%` }}
              >
                {text}
              </span>
            ))}
            <span className="absolute right-0 whitespace-nowrap">
              {formatEffortDuration(last)}
            </span>
          </>
        }
      >
        {[1, 2, 3].map((step) => (
          <line
            key={step}
            x1={0}
            x2={VIEW_WIDTH}
            y1={toY(gridStep * step)}
            y2={toY(gridStep * step)}
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={area}
          className={ANALYSIS_SERIES_COLOURS.power.fill}
          fillOpacity={0.12}
        />
        <path
          d={line}
          fill="none"
          className={ANALYSIS_SERIES_COLOURS.power.stroke}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </MiniChart>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  )
}

export interface ActivityDistributionRowProps {
  heartRateZones: HeartRateZone[]
  heartRateStats: HeartRateStats | null
  powerDistribution: PowerDistribution
  avgPower: number | null
  maxPower: number | null
  powerCurve: PowerEffort[]
}

/**
 * Heart-rate zones, the power distribution and the power curve side by side:
 * three across a desktop column, two over one on a tablet, stacked on a phone.
 * Each is left out when the file has nothing to draw it from.
 */
export const ActivityDistributionRow: FC<ActivityDistributionRowProps> = ({
  heartRateZones,
  heartRateStats,
  powerDistribution,
  avgPower,
  maxPower,
  powerCurve
}) => {
  const hasZones = heartRateZones.some((zone) => zone.seconds > 0)
  const hasDistribution = powerDistribution.bins.length > 0
  const hasCurve = powerCurve.length >= 2
  if (!hasZones && !hasDistribution && !hasCurve) return null

  return (
    <div
      id="zones"
      className="grid scroll-mt-4 gap-6 @min-[600px]:grid-cols-2 @min-[600px]:gap-4 @min-[600px]:[&>*:last-child:nth-child(odd)]:col-span-2 @min-[820px]:grid-cols-3 @min-[820px]:[&>*:last-child:nth-child(odd)]:col-span-1"
    >
      {hasZones ? (
        <Section
          title="Heart rate zones"
          icon={HeartPulse}
          meta={
            heartRateStats
              ? `avg ${heartRateStats.avg} · max ${heartRateStats.max}`
              : undefined
          }
          className="min-w-0"
        >
          <Frame className="px-3.5 py-3">
            <HeartRateZonesPanel zones={heartRateZones} />
          </Frame>
        </Section>
      ) : null}
      {hasDistribution ? (
        <Section
          title="Power distribution"
          icon={BarChart3}
          meta={
            avgPower !== null && maxPower !== null
              ? `avg ${Math.round(avgPower)} · max ${Math.round(maxPower)} W`
              : undefined
          }
          className="min-w-0"
        >
          <Frame className="space-y-2.5 px-3.5 py-3">
            <PowerDistributionChart
              distribution={powerDistribution}
              avgPower={avgPower}
            />
          </Frame>
        </Section>
      ) : null}
      {hasCurve ? (
        <Section
          title="Power curve"
          icon={TrendingUp}
          meta="best average per duration"
          className="min-w-0"
        >
          <Frame className="space-y-2.5 px-3.5 py-3">
            <PowerCurveChart curve={powerCurve} />
          </Frame>
        </Section>
      ) : null}
    </div>
  )
}
