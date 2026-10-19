'use client'

import {
  Activity,
  Clock,
  Flame,
  Gauge,
  HeartPulse,
  Mountain,
  Route,
  Trophy,
  Zap
} from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import type { StatusFitnessFileItem } from '@/lib/client'
import { RetryFitnessButton } from '@/lib/components/posts/retry-fitness-button'
import { Alert } from '@/lib/components/surface/Alert'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { getFitnessPaceOrSpeed } from '@/lib/utils/fitness'
import { type PublicMapProvider } from '@/lib/utils/mapProvider'

import {
  ActivityAnalysisChart,
  type ActivityAnalysisChartProps
} from './ActivityAnalysisChart'
import { ActivityBestEfforts } from './ActivityBestEfforts'
import { ActivityDistributionRow } from './ActivityDistributionRow'
import {
  ActivityMapPanel,
  type ActivityMapPanelProps
} from './ActivityMapPanel'
import {
  ActivityOverviewSection,
  type OverviewGroup
} from './ActivityOverviewSection'
import {
  ActivityPostFrame,
  type ActivityTile,
  getRouteMapAttachmentIndex
} from './ActivityPostFrame'
import { ActivitySplitsTables } from './ActivitySplitsTables'
import {
  type AnalysisGraphKey,
  GraphDisplayCard,
  type GraphDisplayMode
} from './FitnessAnalysisCharts'
import {
  type AnalysisSeries,
  deriveActivityAnalysis,
  findPointAtElapsed
} from './activityAnalysis'
import { getActivityLabel } from './activityLabels'
import { average, formatLapPattern } from './fitnessActivityMetrics'
import { formatDuration, getSeriesMinMax } from './fitnessChartData'
import {
  type ScrubStore,
  createScrubStore,
  useScrubPosition
} from './scrubStore'
import { useActivityRouteData } from './useActivityRouteData'
import { useFitnessGearAssignment } from './useFitnessGearAssignment'
import { useMakePrimaryRecording } from './useMakePrimaryRecording'
import { useStatusFitnessFiles } from './useStatusFitnessFiles'

interface Props {
  host: string
  /** Which map backend renders the activity route map. */
  mapProvider: PublicMapProvider
  currentTime: number
  currentActor?: ActorProfile | null
  status: StatusNote
  replies?: Status[]
  isMediaUploadEnabled?: boolean
  initialFitnessFiles?: StatusFitnessFileItem[]
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
}

/**
 * The series a chart starts with. Speed and grade start off when the file has
 * power (power tells the effort, elevation the terrain); without power only
 * grade starts off, since elevation already draws the terrain.
 */
export const isGraphShownByDefault = (
  key: AnalysisGraphKey,
  hasPower: boolean
): boolean => (hasPower ? key !== 'speed' && key !== 'grade' : key !== 'grade')

const EMPTY_REPLIES: Status[] = []

// The two views that follow the scrubbed instant. Each subscribes to the
// store itself, so a hover re-renders the chart and the map and nothing else.
const ScrubbedMapPanel: FC<
  Omit<ActivityMapPanelProps, 'highlightedElapsedSeconds'> & {
    scrubStore: ScrubStore
  }
> = ({ scrubStore, ...props }) => (
  <ActivityMapPanel
    {...props}
    highlightedElapsedSeconds={useScrubPosition(scrubStore)}
  />
)

const ScrubbedAnalysisChart: FC<
  Omit<
    ActivityAnalysisChartProps,
    'highlightedElapsedSeconds' | 'onHighlightElapsedSeconds'
  > & { scrubStore: ScrubStore }
> = ({ scrubStore, ...props }) => (
  <ActivityAnalysisChart
    {...props}
    highlightedElapsedSeconds={useScrubPosition(scrubStore)}
    onHighlightElapsedSeconds={scrubStore.set}
  />
)
const MAP_ASPECT_CLASS = 'aspect-video @min-[820px]:aspect-[4/3]'

const ActivityAnalysisLoadingState: FC<{
  series: Array<{ key: string; label: string; widthClass: string }>
  hasLikelyLaps: boolean
  hasMap: boolean
}> = ({ series, hasLikelyLaps, hasMap }) => (
  <div className="space-y-4">
    <div
      role="status"
      aria-label="Loading activity analysis"
      className="space-y-4"
    >
      <div data-testid="analysis-controls-skeleton">
        <Frame className="space-y-2.5 bg-card px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SkeletonBar className="h-3 w-24" />
            <div className="flex gap-1">
              <SkeletonBar className="h-7 w-20 rounded-md" />
              <SkeletonBar className="h-7 w-20 rounded-md" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {series.map(({ key, label, widthClass }) => (
              <div
                key={key}
                aria-hidden="true"
                data-testid="analysis-series-chip-placeholder"
                data-series={key}
                data-series-label={label}
                className="flex items-center gap-2 rounded-full border bg-background px-3 py-1"
              >
                <span className="size-2 shrink-0 rounded-full bg-muted" />
                <SkeletonBar className={`h-5 ${widthClass}`} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <SkeletonBar
              className={
                hasMap
                  ? 'h-8 w-full @min-[520px]:h-4 @min-[520px]:w-96'
                  : 'h-4 w-48'
              }
            />
          </div>
        </Frame>
      </div>
      <div>
        <Frame className="overflow-hidden">
          {hasLikelyLaps ? (
            <div
              data-testid="analysis-laps-skeleton"
              className="relative border-b bg-muted/40"
            >
              <div className="no-scrollbar flex gap-1 overflow-hidden px-4 py-2">
                {Array.from({ length: 3 }, (_, index) => (
                  <SkeletonBar
                    key={index}
                    className="h-10 min-w-36 flex-1 basis-0 rounded-md"
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2 px-4 pb-2.5 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SkeletonBar className="h-5 w-20" />
            </div>
            <div
              data-testid="analysis-plot-skeleton"
              className="relative h-[190px] w-full @min-[700px]:h-[250px]"
            >
              <SkeletonBar className="h-full w-full rounded-md" />
            </div>
            <SkeletonBar className="h-4 w-full rounded-md" />
          </div>
        </Frame>
      </div>
    </div>
  </div>
)

const formatKm = (meters: number) => {
  const km = meters / 1000
  return km >= 10 ? km.toFixed(1) : km.toFixed(2)
}

/**
 * A completed fitness activity's own page: the post (with its photos, figures
 * and replies), then the route and figures, the analysis charts, best efforts,
 * the zone and power charts, and the laps and climbs. Every section below the
 * post reads the recording's route data and is left out when the file has
 * nothing for it.
 */
export const FitnessStatusDetail: FC<Props> = ({
  host,
  mapProvider,
  currentTime,
  currentActor,
  status,
  replies = EMPTY_REPLIES,
  isMediaUploadEnabled,
  initialFitnessFiles,
  onShowAttachment
}) => {
  const isOwner =
    Boolean(status.isLocalActor) && currentActor?.id === status.actorId
  const files = useStatusFitnessFiles(status, initialFitnessFiles)
  const { fitness, fitnessFiles, setFitnessFiles, setSelectedFitnessFileId } =
    files
  const gear = useFitnessGearAssignment({ isOwner, fitness, setFitnessFiles })
  const primary = useMakePrimaryRecording({
    fitnessFiles,
    setFitnessFiles,
    setSelectedFitnessFileId
  })
  const route = useActivityRouteData(fitness?.id)
  const isRouteAnalysisUnavailable = route.isLoading || Boolean(route.error)

  const [graphDisplayMode, setGraphDisplayMode] =
    useState<GraphDisplayMode>('combined')
  // Paused time is cut out of the chart by default, as on Strava.
  const [showPauses, setShowPauses] = useState(false)
  // The reader's own choices; a series they have not touched follows
  // `isGraphShownByDefault`, so the default stays right as the recording on
  // screen (and the series it has) changes.
  const [graphChoices, setGraphChoices] = useState<
    Partial<Record<AnalysisGraphKey, boolean>>
  >({})
  const [selectedSplitKey, setSelectedSplitKey] = useState<string | null>(null)
  // The scrubbed instant lives outside React state (see `scrubStore`).
  const [scrubStore] = useState(createScrubStore)
  const chartRef = useRef<HTMLDivElement | null>(null)

  // A lap, a climb or a scrubbed instant belongs to the recording it was
  // picked on.
  useEffect(() => {
    setSelectedSplitKey(null)
    scrubStore.set(null)
  }, [fitness?.id, scrubStore])

  const activityType = fitness?.activityType ?? null
  const analysis = useMemo(
    () =>
      route.data
        ? deriveActivityAnalysis({
            data: route.data,
            activityType,
            fallbackDurationSeconds: fitness?.totalDurationSeconds ?? 0,
            movingTimeSeconds: fitness?.movingTimeSeconds ?? null,
            skipPauses: !showPauses
          })
        : null,
    [
      route.data,
      activityType,
      fitness?.totalDurationSeconds,
      fitness?.movingTimeSeconds,
      showPauses
    ]
  )

  // A single lap is the whole activity again, so it is no split at all.
  const laps = useMemo(
    () => (analysis && analysis.laps.length >= 2 ? analysis.laps : []),
    [analysis]
  )
  const climbs = useMemo(() => analysis?.climbs ?? [], [analysis])
  const selectedSplit = useMemo(
    () =>
      [...laps, ...climbs].find((split) => split.key === selectedSplitKey) ??
      null,
    [laps, climbs, selectedSplitKey]
  )
  const highlightedRange = useMemo(
    () =>
      selectedSplit
        ? {
            startSeconds: selectedSplit.startSeconds,
            endSeconds: selectedSplit.endSeconds
          }
        : null,
    [selectedSplit]
  )

  const toggleSplit = (key: string) => {
    setSelectedSplitKey((current) => (current === key ? null : key))
  }
  // From a table far below the chart: pick it and bring the chart into view.
  const selectSplitFromTable = (key: string) => {
    const isSelecting = selectedSplitKey !== key
    toggleSplit(key)
    if (isSelecting) {
      chartRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }

  // ---- figures ------------------------------------------------------------

  const distanceMeters = fitness?.totalDistanceMeters ?? 0
  const durationSeconds =
    analysis?.durationSeconds ?? fitness?.totalDurationSeconds ?? 0
  const movingTimeSeconds =
    typeof fitness?.movingTimeSeconds === 'number' &&
    fitness.movingTimeSeconds > 0
      ? fitness.movingTimeSeconds
      : (fitness?.totalDurationSeconds ?? 0)
  const paceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitness?.totalDistanceMeters ?? undefined,
    durationSeconds: fitness?.totalDurationSeconds ?? undefined,
    movingTimeSeconds: fitness?.movingTimeSeconds ?? undefined,
    activityType: fitness?.activityType ?? undefined
  })
  const usesPace = paceOrSpeed?.label === 'Pace'

  const powerSeries = analysis?.powerSeries ?? []
  const avgPower =
    typeof fitness?.avgPower === 'number'
      ? Math.round(fitness.avgPower)
      : powerSeries.length > 0
        ? Math.round(average(powerSeries) as number)
        : null
  const maxPower =
    typeof fitness?.maxPower === 'number'
      ? Math.round(fitness.maxPower)
      : powerSeries.length > 0
        ? Math.round(getSeriesMinMax(powerSeries).maxValue)
        : null
  const normalizedPower = analysis?.normalizedPower ?? null
  // Average power is over the recorded samples, so work is too: running time,
  // not elapsed time, which would count an auto-paused stop as pedalling.
  const workSeconds = analysis?.recordingSeconds ?? movingTimeSeconds
  const totalWorkKj =
    typeof fitness?.totalWorkKj === 'number'
      ? Math.round(fitness.totalWorkKj)
      : avgPower !== null && workSeconds > 0
        ? Math.round((avgPower * workSeconds) / 1000)
        : null
  const heartRateStats =
    analysis?.heartRateStats ??
    (typeof fitness?.avgHeartRate === 'number'
      ? {
          avg: Math.round(fitness.avgHeartRate),
          max: Math.round(fitness.maxHeartRate ?? fitness.avgHeartRate)
        }
      : null)
  const heartRateZones = analysis?.heartRateZones ?? []
  const effortPower = normalizedPower ?? avgPower

  const calories = analysis?.calories ?? null
  const hasSummaryPower =
    typeof fitness?.avgPower === 'number' ||
    typeof fitness?.maxPower === 'number'
  const hasSummaryHeartRate =
    typeof fitness?.avgHeartRate === 'number' ||
    typeof fitness?.maxHeartRate === 'number'
  const hasSummaryElevation =
    (fitness?.elevationSeries?.length ?? 0) > 1 ||
    (fitness?.elevationGainMeters ?? 0) > 0
  const hasStructuredFitnessFormat =
    fitness?.fileType === 'fit' || fitness?.fileType === 'tcx'
  const activityTypeKey = activityType?.toLowerCase() ?? ''
  const isCadenceSport = /ride|cycl|run|bike/.test(activityTypeKey)
  // Summary sensors are the best pre-route signal for optional route-only rows.
  const hasSummarySensors = hasSummaryPower || hasSummaryHeartRate
  const likelyHasCadence =
    hasStructuredFitnessFormat && isCadenceSport && hasSummarySensors
  const expectedAnalysisSeries = [
    {
      key: 'elevation',
      label: 'Elevation',
      widthClass: 'w-16',
      available: hasSummaryElevation
    },
    {
      key: 'speed',
      label: 'Speed',
      widthClass: 'w-10',
      available: distanceMeters > 0 && durationSeconds > 0
    },
    {
      key: 'power',
      label: 'Power',
      widthClass: 'w-11',
      available: hasSummaryPower
    },
    {
      key: 'heart-rate',
      label: 'Heart rate',
      widthClass: 'w-16',
      available: hasSummaryHeartRate
    },
    {
      key: 'cadence',
      label: 'Cadence',
      widthClass: 'w-14',
      available: likelyHasCadence
    },
    {
      key: 'grade',
      label: 'Grade',
      widthClass: 'w-10',
      available: hasSummaryElevation && distanceMeters > 0
    }
  ].filter(({ available }) => available)
  const tiles = useMemo<ActivityTile[]>(() => {
    const candidates: Array<ActivityTile | null> = [
      distanceMeters > 0
        ? {
            key: 'distance',
            label: 'Distance',
            icon: Route,
            value: formatKm(distanceMeters),
            unit: 'km'
          }
        : null,
      movingTimeSeconds > 0
        ? {
            key: 'moving-time',
            label: 'Moving time',
            icon: Clock,
            value: formatDuration(movingTimeSeconds),
            unit: 'moving'
          }
        : null,
      // A flat or indoor activity has no climbing to show; its slot goes to
      // the next figure rather than a "0 m gain".
      typeof fitness?.elevationGainMeters === 'number' &&
      Math.round(fitness.elevationGainMeters) > 0
        ? {
            key: 'elevation',
            label: 'Elevation',
            icon: Mountain,
            value: `${Math.max(0, Math.round(fitness.elevationGainMeters))}`,
            unit: 'm gain'
          }
        : null,
      normalizedPower !== null
        ? {
            key: 'power',
            label: 'Weighted power',
            icon: Gauge,
            value: `${normalizedPower}`,
            unit: 'watts'
          }
        : avgPower !== null
          ? {
              key: 'power',
              label: 'Avg power',
              icon: Gauge,
              value: `${avgPower}`,
              unit: 'watts'
            }
          : null,
      paceOrSpeed
        ? {
            key: 'pace',
            label: usesPace ? 'Avg pace' : 'Avg speed',
            icon: Gauge,
            value: usesPace
              ? paceOrSpeed.value.replace(/\s*\/km$/, '')
              : (paceOrSpeed.speedKmh as number).toFixed(1),
            unit: usesPace ? '/km' : 'km/h',
            accent: true
          }
        : null,
      // Fill-ins for an activity that lacks one of the four above (an indoor
      // ride has no distance, pace or climbing), so the strip still fills.
      heartRateStats
        ? {
            key: 'heart-rate',
            label: 'Avg heart rate',
            icon: HeartPulse,
            value: `${heartRateStats.avg}`,
            unit: 'bpm'
          }
        : null,
      totalWorkKj !== null && totalWorkKj > 0
        ? {
            key: 'work',
            label: 'Work',
            icon: Zap,
            value: `${totalWorkKj}`,
            unit: 'kJ'
          }
        : null,
      typeof calories === 'number' && calories > 0
        ? {
            key: 'calories',
            label: 'Calories',
            icon: Flame,
            value: `${Math.round(calories)}`,
            unit: 'kcal'
          }
        : null
    ]
    const available = candidates.filter(
      (tile): tile is ActivityTile => tile !== null
    )
    // Show four, or two when there are not four to show, never three: the
    // band also copes with an odd count (its last cell spans the row, so no
    // border-coloured cell shows), but 2×2 and 4-up are the designed shapes.
    return available.slice(
      0,
      available.length >= 4 ? 4 : available.length >= 2 ? 2 : 1
    )
  }, [
    distanceMeters,
    movingTimeSeconds,
    fitness?.elevationGainMeters,
    normalizedPower,
    avgPower,
    paceOrSpeed,
    usesPace,
    heartRateStats,
    totalWorkKj,
    calories
  ])

  // Stored values reserve rows exactly when the summary supports them. It has
  // no availability flags for calories, laps, cadence, balance or decoupling,
  // so reserve the likely rows from the file type and stored power/HR totals.
  const overviewGroups: OverviewGroup[] = [
    {
      key: 'ride',
      title: getActivityLabel(activityType ?? undefined),
      colour: 'speed',
      rows: [
        {
          label: 'Elapsed time',
          value: durationSeconds > 0 ? formatDuration(durationSeconds) : null
        },
        {
          label: usesPace ? 'Avg pace' : 'Avg speed',
          value: paceOrSpeed?.value ?? null
        },
        {
          label: 'Max speed',
          value:
            analysis?.maxSpeedKmh && analysis.maxSpeedKmh > 0
              ? `${analysis.maxSpeedKmh.toFixed(1)} km/h`
              : null,
          reserveWhenLoading: distanceMeters > 0
        },
        {
          label: 'Calories',
          value:
            typeof analysis?.calories === 'number' && analysis.calories > 0
              ? `${Math.round(analysis.calories)} kcal`
              : null,
          reserveWhenLoading:
            hasStructuredFitnessFormat &&
            hasSummarySensors &&
            durationSeconds > 0
        },
        {
          label: 'Laps',
          value: formatLapPattern(laps),
          reserveWhenLoading:
            hasStructuredFitnessFormat &&
            hasSummarySensors &&
            durationSeconds > 0
        }
      ]
    },
    {
      key: 'power',
      title: 'Power',
      colour: 'power',
      rows: [
        {
          label: 'Avg / max',
          value:
            avgPower !== null
              ? maxPower !== null
                ? `${avgPower} / ${maxPower} W`
                : `${avgPower} W`
              : null,
          reserveWhenLoading: hasSummaryPower
        },
        {
          label: 'Weighted',
          value: normalizedPower !== null ? `${normalizedPower} W` : null,
          reserveWhenLoading: hasSummaryPower
        },
        {
          label: 'Variability',
          value:
            normalizedPower !== null && avgPower
              ? (normalizedPower / avgPower).toFixed(2)
              : null,
          reserveWhenLoading: hasSummaryPower
        },
        {
          label: 'Work',
          value: totalWorkKj !== null ? `${totalWorkKj} kJ` : null,
          reserveWhenLoading: hasSummaryPower && durationSeconds > 0
        },
        {
          label: 'L / R balance',
          value: analysis?.leftRightBalance
            ? `${analysis.leftRightBalance.left} / ${analysis.leftRightBalance.right}`
            : null,
          reserveWhenLoading: hasSummaryPower && hasStructuredFitnessFormat
        }
      ]
    },
    {
      key: 'heart-rate',
      title: 'Heart rate',
      colour: 'heart-rate',
      rows: [
        {
          label: 'Avg / max',
          value: heartRateStats
            ? `${heartRateStats.avg} / ${heartRateStats.max} bpm`
            : null,
          reserveWhenLoading: hasSummaryHeartRate
        },
        {
          label: 'Power / HR',
          value:
            effortPower !== null && heartRateStats && heartRateStats.avg > 0
              ? (effortPower / heartRateStats.avg).toFixed(2)
              : null,
          reserveWhenLoading: hasSummaryPower && hasSummaryHeartRate
        },
        {
          label: 'Time in Z3–Z4',
          value:
            heartRateZones.length >= 4
              ? formatDuration(
                  Math.round(
                    heartRateZones[2].seconds + heartRateZones[3].seconds
                  )
                )
              : null,
          reserveWhenLoading: hasSummaryHeartRate
        },
        {
          label: 'Decoupling',
          value:
            typeof analysis?.decouplingPercent === 'number'
              ? `${analysis.decouplingPercent.toFixed(1)} %`
              : null,
          reserveWhenLoading:
            hasSummaryPower && hasSummaryHeartRate && durationSeconds >= 600
        }
      ]
    },
    {
      key: 'cadence',
      title: 'Cadence and weather',
      colour: 'cadence',
      rows: [
        {
          label: 'Avg cadence',
          value:
            typeof analysis?.avgCadence === 'number'
              ? `${Math.round(analysis.avgCadence)} ${analysis.cadenceUnit}`
              : null,
          reserveWhenLoading: likelyHasCadence
        },
        {
          label: 'Temperature',
          value: analysis?.temperature
            ? `${Math.round(analysis.temperature.min)} – ${Math.round(analysis.temperature.max)} °C`
            : null
        },
        {
          label: 'Avg temperature',
          value: analysis?.temperature
            ? `${analysis.temperature.avg.toFixed(1)} °C`
            : null
        },
        {
          label: 'Time at 0 W',
          value:
            typeof analysis?.timeAtZeroPowerSeconds === 'number'
              ? formatDuration(Math.round(analysis.timeAtZeroPowerSeconds))
              : null,
          reserveWhenLoading: hasSummaryPower
        }
      ]
    }
  ]

  // ---- map ----------------------------------------------------------------

  const mapAttachmentIndex = getRouteMapAttachmentIndex(
    status.attachments,
    Boolean(fitness?.hasMapData)
  )
  const mapAttachment =
    mapAttachmentIndex >= 0 ? status.attachments[mapAttachmentIndex] : undefined
  const routeSamples = route.data?.samples
  const routeSegments = route.data?.segments
  const hasRouteGeometry =
    (routeSegments?.length ?? 0) > 0 || (routeSamples?.length ?? 0) >= 2
  const shouldRenderMap =
    Boolean(mapAttachment) || Boolean(fitness?.hasMapData) || hasRouteGeometry
  const map = shouldRenderMap ? (
    <ScrubbedMapPanel
      scrubStore={scrubStore}
      mapAttachment={mapAttachment}
      routeSamples={routeSamples}
      routeSegments={routeSegments}
      highlightedRange={highlightedRange}
      aspectClassName={MAP_ASPECT_CLASS}
      mapProvider={mapProvider}
      routeDataError={route.error}
      isRouteDataLoading={route.isLoading}
      interactive
      onOpenMap={() => {
        if (mapAttachmentIndex >= 0) {
          onShowAttachment(status.attachments, mapAttachmentIndex)
        }
      }}
    />
  ) : null

  // ---- analysis -----------------------------------------------------------

  const hasPower = powerSeries.length > 0
  const availableSeries = analysis?.series ?? []
  const shownSeries: AnalysisSeries[] = availableSeries.filter(
    (entry) =>
      graphChoices[entry.key] ?? isGraphShownByDefault(entry.key, hasPower)
  )
  const toggleGraph = (key: AnalysisGraphKey) => {
    setGraphChoices((current) => ({
      ...current,
      [key]: !(current[key] ?? isGraphShownByDefault(key, hasPower))
    }))
  }
  const describePosition = (elapsedSeconds: number): string | null => {
    if (!analysis) return null
    const point = findPointAtElapsed(analysis.timeline, elapsedSeconds)
    const parts: string[] = []
    if (point && typeof point.distanceMeters === 'number') {
      parts.push(`${(point.distanceMeters / 1000).toFixed(1)} km`)
    }
    const lapIndex = laps.findIndex(
      (lap) =>
        elapsedSeconds >= lap.startSeconds && elapsedSeconds <= lap.endSeconds
    )
    if (lapIndex >= 0) parts.push(`lap ${lapIndex + 1}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  const fileLabel = fitness?.fileType ? fitness.fileType.toUpperCase() : null
  const graphCount = availableSeries.length
  const analysisMeta = `${graphCount} ${graphCount === 1 ? 'graph' : 'graphs'} from the ${fileLabel ? `${fileLabel} ` : ''}file`
  const graphHint =
    graphDisplayMode === 'combined'
      ? `Pick the graphs to overlay in one chart.${map ? ' Hover it to follow that time point on the map.' : ''}`
      : `Pick the graphs to show.${map ? ' Hover any graph to follow that time point on the map.' : ''}`

  const overviewMeta =
    distanceMeters > 0 && durationSeconds > 0
      ? `${formatKm(distanceMeters)} km · ${formatDuration(durationSeconds)} elapsed`
      : durationSeconds > 0
        ? `${formatDuration(durationSeconds)} elapsed`
        : undefined
  const lapsMeta = (() => {
    const pattern = formatLapPattern(laps)
    if (!pattern || !pattern.includes('×')) return `${laps.length}`
    return `${laps.length} · every ${pattern.split('× ')[1]}`
  })()

  return (
    <div>
      {/* The post is flush in the page card, directly under its header, like
          the focused post on the post page; the sections after it sit in the
          padded column. */}
      <ActivityPostFrame
        host={host}
        currentTime={currentTime}
        currentActor={currentActor}
        status={status}
        replies={replies}
        isMediaUploadEnabled={isMediaUploadEnabled}
        isOwner={isOwner}
        files={files}
        gear={gear}
        primary={primary}
        mapAttachmentIndex={mapAttachmentIndex}
        tiles={tiles}
        onShowAttachment={onShowAttachment}
      />

      <div className="@container space-y-6 border-t p-4 empty:hidden">
        {/* This page replaces `Post` for a completed activity, so the retry
          `Post` offers for a missing route map has to exist here too. Read from
          `status.fitness` (the primary file), not the recording on screen: the
          retry endpoint only acts on the primary. */}
        {status.fitness?.mapFailure &&
        status.fitness?.processingStatus === 'completed' &&
        isOwner ? (
          <RetryFitnessButton
            statusId={status.id}
            variant={`map-${status.fitness.mapFailure}`}
          />
        ) : null}

        <ActivityOverviewSection
          meta={overviewMeta}
          map={map}
          groups={overviewGroups}
          reserveRows={route.isLoading}
        />

        {isRouteAnalysisUnavailable ||
        (analysis && availableSeries.length > 0) ? (
          <Section
            id="analysis"
            title="Analysis"
            icon={Activity}
            meta={
              !isRouteAnalysisUnavailable && analysis ? analysisMeta : undefined
            }
          >
            {route.error ? (
              <Alert tone="warning" title={route.error} />
            ) : route.isLoading ? (
              <ActivityAnalysisLoadingState
                series={expectedAnalysisSeries}
                hasLikelyLaps={
                  hasStructuredFitnessFormat &&
                  hasSummarySensors &&
                  durationSeconds > 0
                }
                hasMap={shouldRenderMap}
              />
            ) : analysis ? (
              <>
                <GraphDisplayCard
                  mode={graphDisplayMode}
                  onModeChange={setGraphDisplayMode}
                  options={availableSeries.map((entry) => ({
                    key: entry.key,
                    label: entry.label
                  }))}
                  selectedKeys={shownSeries.map((entry) => entry.key)}
                  onToggle={toggleGraph}
                  hint={graphHint}
                  showPauses={
                    analysis.pauses.length > 0 ? showPauses : undefined
                  }
                  onShowPausesChange={setShowPauses}
                />
                <div ref={chartRef}>
                  <ScrubbedAnalysisChart
                    scrubStore={scrubStore}
                    series={shownSeries}
                    mode={graphDisplayMode}
                    durationSeconds={analysis.durationSeconds}
                    chartAxis={analysis.chartAxis}
                    pauses={analysis.pauses}
                    laps={laps}
                    climbs={climbs}
                    selectedKey={selectedSplitKey}
                    onToggleSplit={toggleSplit}
                    describePosition={describePosition}
                  />
                </div>
              </>
            ) : null}
          </Section>
        ) : null}

        {route.isLoading ? (
          (() => {
            const expectedDistributionCount =
              (hasSummaryHeartRate ? 1 : 0) + (hasSummaryPower ? 2 : 0)
            return (
              <>
                {hasSummaryPower && durationSeconds >= 5 ? (
                  <Section
                    id="best-efforts"
                    title="Best efforts"
                    icon={Trophy}
                    meta="power"
                  >
                    <Frame className="p-3">
                      <SkeletonBar className="h-12 w-full rounded-md" />
                    </Frame>
                  </Section>
                ) : null}
                {expectedDistributionCount > 0 ? (
                  <div
                    data-testid="analysis-distribution-skeleton"
                    className="grid gap-6 @min-[600px]:grid-cols-2 @min-[600px]:gap-4 @min-[600px]:[&>*:last-child:nth-child(odd)]:col-span-2 @min-[820px]:grid-cols-3 @min-[820px]:[&>*:last-child:nth-child(odd)]:col-span-1"
                  >
                    {Array.from(
                      { length: expectedDistributionCount },
                      (_, index) => (
                        <Frame key={index} className="h-44 space-y-2 p-4">
                          <SkeletonBar className="h-4 w-28" />
                          <SkeletonBar className="h-28 w-full" />
                        </Frame>
                      )
                    )}
                  </div>
                ) : null}
              </>
            )
          })()
        ) : analysis ? (
          <>
            <ActivityBestEfforts efforts={analysis.bestEfforts} />
            <ActivityDistributionRow
              heartRateZones={heartRateZones}
              heartRateStats={heartRateStats}
              powerDistribution={analysis.powerDistribution}
              avgPower={avgPower}
              maxPower={maxPower}
              powerCurve={analysis.powerCurve}
            />
            <ActivitySplitsTables
              laps={laps}
              climbs={climbs}
              lapsMeta={lapsMeta}
              usesPace={usesPace}
              selectedKey={selectedSplitKey}
              onSelect={selectSplitFromTable}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
