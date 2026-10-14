'use client'

import { Activity, Clock, Gauge, Mountain, Route } from 'lucide-react'
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

import { ActivityAnalysisChart } from './ActivityAnalysisChart'
import { ActivityBestEfforts } from './ActivityBestEfforts'
import { ActivityDistributionRow } from './ActivityDistributionRow'
import { ActivityMapPanel } from './ActivityMapPanel'
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
const MAP_ASPECT_CLASS = 'aspect-video @min-[820px]:aspect-[4/3]'

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

  const [graphDisplayMode, setGraphDisplayMode] =
    useState<GraphDisplayMode>('combined')
  // The reader's own choices; a series they have not touched follows
  // `isGraphShownByDefault`, so the default stays right as the recording on
  // screen (and the series it has) changes.
  const [graphChoices, setGraphChoices] = useState<
    Partial<Record<AnalysisGraphKey, boolean>>
  >({})
  const [selectedSplitKey, setSelectedSplitKey] = useState<string | null>(null)
  const [highlightedElapsedSeconds, setHighlightedElapsedSeconds] = useState<
    number | null
  >(null)
  const chartRef = useRef<HTMLDivElement | null>(null)

  // A lap, a climb or a scrubbed instant belongs to the recording it was
  // picked on.
  useEffect(() => {
    setSelectedSplitKey(null)
    setHighlightedElapsedSeconds(null)
  }, [fitness?.id])

  const activityType = fitness?.activityType ?? null
  const analysis = useMemo(
    () =>
      route.data
        ? deriveActivityAnalysis({
            data: route.data,
            activityType,
            fallbackDurationSeconds: fitness?.totalDurationSeconds ?? 0
          })
        : null,
    [route.data, activityType, fitness?.totalDurationSeconds]
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
  const totalWorkKj =
    typeof fitness?.totalWorkKj === 'number'
      ? Math.round(fitness.totalWorkKj)
      : avgPower !== null && durationSeconds > 0
        ? Math.round((avgPower * durationSeconds) / 1000)
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
      typeof fitness?.elevationGainMeters === 'number'
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
        : null
    ]
    return candidates
      .filter((tile): tile is ActivityTile => tile !== null)
      .slice(0, 4)
  }, [
    distanceMeters,
    movingTimeSeconds,
    fitness?.elevationGainMeters,
    normalizedPower,
    avgPower,
    paceOrSpeed,
    usesPace
  ])

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
              : null
        },
        {
          label: 'Calories',
          value:
            typeof analysis?.calories === 'number' && analysis.calories > 0
              ? `${Math.round(analysis.calories)} kcal`
              : null
        },
        { label: 'Laps', value: formatLapPattern(laps) }
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
              : null
        },
        {
          label: 'Weighted',
          value: normalizedPower !== null ? `${normalizedPower} W` : null
        },
        {
          label: 'Variability',
          value:
            normalizedPower !== null && avgPower
              ? (normalizedPower / avgPower).toFixed(2)
              : null
        },
        {
          label: 'Work',
          value: totalWorkKj !== null ? `${totalWorkKj} kJ` : null
        },
        {
          label: 'L / R balance',
          value: analysis?.leftRightBalance
            ? `${analysis.leftRightBalance.left} / ${analysis.leftRightBalance.right}`
            : null
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
            : null
        },
        {
          label: 'Power / HR',
          value:
            effortPower !== null && heartRateStats && heartRateStats.avg > 0
              ? (effortPower / heartRateStats.avg).toFixed(2)
              : null
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
              : null
        },
        {
          label: 'Decoupling',
          value:
            typeof analysis?.decouplingPercent === 'number'
              ? `${analysis.decouplingPercent.toFixed(1)} %`
              : null
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
              : null
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
              : null
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
    <ActivityMapPanel
      mapAttachment={mapAttachment}
      routeSamples={routeSamples}
      routeSegments={routeSegments}
      highlightedElapsedSeconds={highlightedElapsedSeconds}
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
    <div className="@container space-y-6 p-4 sm:p-5">
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

      {/* With no map to carry the banner, the failure is shown here so it is
          never invisible. */}
      {route.error && !map ? (
        <Alert tone="warning" title={route.error} />
      ) : null}

      <ActivityOverviewSection
        meta={overviewMeta}
        map={map}
        groups={overviewGroups}
      />

      {route.isLoading ? (
        <Section id="analysis" title="Analysis" icon={Activity}>
          <Frame className="space-y-3 p-4">
            <div role="status">
              <span className="sr-only">Loading analysis</span>
              <SkeletonBar className="h-[190px] @min-[700px]:h-[250px]" />
            </div>
          </Frame>
        </Section>
      ) : analysis && availableSeries.length > 0 ? (
        <Section
          id="analysis"
          title="Analysis"
          icon={Activity}
          meta={analysisMeta}
        >
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
          />
          <div ref={chartRef}>
            <ActivityAnalysisChart
              series={shownSeries}
              mode={graphDisplayMode}
              durationSeconds={analysis.durationSeconds}
              laps={laps}
              climbs={climbs}
              selectedKey={selectedSplitKey}
              onToggleSplit={toggleSplit}
              highlightedElapsedSeconds={highlightedElapsedSeconds}
              onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
              describePosition={describePosition}
            />
          </div>
        </Section>
      ) : null}

      {analysis ? (
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
  )
}
