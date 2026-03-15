'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'
import { Bike, Footprints, Play, Plus, Waves } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { VisibilityButton } from '@/lib/components/posts/actions/visibility-button'
import { Media } from '@/lib/components/posts/media'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { StatusNote } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  getFitnessPaceOrSpeed
} from '@/lib/utils/fitness'
import { loadMapboxModule } from '@/lib/utils/mapbox'

const getActivityIcon = (activityType?: string) => {
  const normalized = activityType?.toLowerCase() ?? ''
  if (normalized.includes('ride') || normalized.includes('bike')) {
    return <Bike className="size-5" />
  }
  if (
    normalized.includes('run') ||
    normalized.includes('walk') ||
    normalized.includes('hike')
  ) {
    return <Footprints className="size-5" />
  }
  if (normalized.includes('swim')) {
    return <Waves className="size-5" />
  }
  return <Bike className="size-5" />
}

const downsampleSeries = (series: number[], targetCount: number) => {
  if (series.length <= targetCount) return series
  const ratio = series.length / targetCount
  const result: number[] = []
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.floor((i + 1) * ratio)
    const chunk = series.slice(start, end)
    const sum = chunk.reduce((a, b) => a + b, 0)
    result.push(sum / chunk.length)
  }
  return result
}

interface Props {
  host: string
  mapboxAccessToken?: string
  currentActor?: ActorProfile | null
  status: StatusNote
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
}

type SectionKey = 'overview' | 'analysis' | '25w-distribution'

type AnalysisGraphKey = 'elevation' | 'speed' | 'power' | 'heart-rate'
type AnalysisGraphFilter = 'all' | AnalysisGraphKey

interface NavItem {
  id: SectionKey
  label: string
  group?: 'subscription'
}

interface FitnessRouteSample {
  lat: number
  lng: number
  elapsedSeconds: number
  timestamp?: number
  altitude?: number
  heartRate?: number
  speed?: number
  isHiddenByPrivacy?: boolean
}

interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

interface FitnessRouteDataResponse {
  samples: FitnessRouteSample[]
  segments?: FitnessRouteSegment[]
  totalDurationSeconds: number
  powerSeries?: number[]
  heartRateSeries?: number[]
  altitudeSeries?: number[]
  speedSeries?: number[]
}

interface StatusFitnessFileItem {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  statusId: string | null
  isPrimary: boolean
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  totalDistanceMeters: number | null
  totalDurationSeconds: number | null
  elevationGainMeters: number | null
  activityType: string | null
  activityStartTime: number | null
  hasMapData: boolean
  description: string | null
}

interface FitnessFilesByStatusResponse {
  files: StatusFitnessFileItem[]
}

interface MapPointGeometry {
  type: 'Point'
  coordinates: [number, number]
}

interface MapLineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

interface RouteLineProperties {
  isHiddenByPrivacy: boolean
}

interface MapFeature<TGeometry, TProperties = Record<string, unknown>> {
  type: 'Feature'
  properties: TProperties
  geometry: TGeometry
}

interface MapFeatureCollection<
  TGeometry,
  TProperties = Record<string, unknown>
> {
  type: 'FeatureCollection'
  features: Array<MapFeature<TGeometry, TProperties>>
}

type MapGeoJSONFeatureCollection =
  | MapFeatureCollection<MapPointGeometry>
  | MapFeatureCollection<MapLineStringGeometry, RouteLineProperties>

interface MapboxGeoJSONSource {
  setData: (data: MapGeoJSONFeatureCollection) => void
}

interface MapboxLngLatBounds {
  extend: (lngLat: [number, number]) => MapboxLngLatBounds
}

interface MapboxMap {
  addSource: (id: string, source: Record<string, unknown>) => void
  addLayer: (layer: Record<string, unknown>) => void
  once: (event: 'load', listener: () => void) => void
  getSource: (id: string) => unknown
  getZoom: () => number
  fitBounds: (
    bounds: MapboxLngLatBounds,
    options: { padding: number; maxZoom: number; duration: number }
  ) => void
  setMinZoom: (zoom: number) => void
  setMaxBounds: (bounds: MapboxLngLatBounds) => void
  zoomIn: (options?: { duration?: number }) => void
  zoomOut: (options?: { duration?: number }) => void
  remove: () => void
}

interface MapboxModule {
  accessToken: string
  Map: new (options: {
    container: HTMLElement
    style: string
    attributionControl: boolean
  }) => MapboxMap
  LngLatBounds: new (
    sw: [number, number],
    ne: [number, number]
  ) => MapboxLngLatBounds
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'analysis', label: 'Analysis' },
  { id: '25w-distribution', label: '25 W Distribution', group: 'subscription' }
]

const ANALYSIS_GRAPH_OPTIONS: Array<{
  id: AnalysisGraphFilter
  label: string
}> = [
  { id: 'all', label: 'All graphs' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'speed', label: 'Speed' },
  { id: 'power', label: 'Power' },
  { id: 'heart-rate', label: 'Heart rate' }
]

const formatDistance = (distanceMeters?: number) =>
  formatFitnessDistance(distanceMeters, { fallback: '0.00 km' }) ?? '0.00 km'

const formatDuration = (durationSeconds?: number) =>
  formatFitnessDuration(durationSeconds, { fallback: '0:00' }) ?? '0:00'

const formatUtcDate = (timestamp: number, pattern: string) => {
  return format(new UTCDate(timestamp), pattern)
}

const getActivityLabel = (activityType?: string) => {
  if (!activityType) return 'Activity'

  const normalized = activityType.toLowerCase()
  if (normalized.includes('ride') || normalized.includes('bike')) {
    return 'Virtual Ride'
  }
  if (normalized.includes('run')) return 'Run'
  if (normalized.includes('walk') || normalized.includes('hike')) return 'Walk'
  if (normalized.includes('swim')) return 'Swim'

  return `${activityType[0].toUpperCase()}${activityType.slice(1)}`
}

const GRAPH_VIEW_HEIGHT = 250
const GRAPH_HEIGHT_CLASSNAME = 'h-[190px] lg:h-[250px]'
const MAP_ROUTE_SOURCE_ID = 'activity-route'
const MAP_ACTIVE_POINT_SOURCE_ID = 'activity-active-point'

const clampNumber = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

const findRouteSampleForElapsed = (
  samples: FitnessRouteSample[],
  elapsedSeconds: number
): FitnessRouteSample | null => {
  if (samples.length === 0) return null
  if (!Number.isFinite(elapsedSeconds)) return null

  let low = 0
  let high = samples.length - 1

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (samples[mid].elapsedSeconds < elapsedSeconds) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  if (low <= 0) return samples[0]

  const candidate = samples[low]
  const previousCandidate = samples[low - 1]

  return Math.abs(previousCandidate.elapsedSeconds - elapsedSeconds) <
    Math.abs(candidate.elapsedSeconds - elapsedSeconds)
    ? previousCandidate
    : candidate
}

const normalizeRouteSample = (
  sample: FitnessRouteSample
): FitnessRouteSample => {
  return {
    ...sample,
    isHiddenByPrivacy: Boolean(sample.isHiddenByPrivacy)
  }
}

const normalizeRouteSegments = ({
  samples,
  segments
}: {
  samples: FitnessRouteSample[]
  segments?: FitnessRouteSegment[]
}): FitnessRouteSegment[] => {
  if (Array.isArray(segments)) {
    const normalizedSegments = segments
      .map((segment) => ({
        isHiddenByPrivacy: Boolean(segment.isHiddenByPrivacy),
        samples: Array.isArray(segment.samples)
          ? segment.samples.map((sample) => normalizeRouteSample(sample))
          : []
      }))
      .filter((segment) => segment.samples.length > 0)

    if (normalizedSegments.length > 0) {
      return normalizedSegments
    }
  }

  if (samples.length >= 2) {
    return [
      {
        isHiddenByPrivacy: false,
        samples
      }
    ]
  }

  return []
}

const getChartYPosition = (
  value: number,
  height: number,
  minValue: number,
  maxValue: number
) => {
  const range = Math.max(1, maxValue - minValue)
  return height - ((value - minValue) / range) * height
}

const clampLongitude = (value: number) => {
  return clampNumber(value, -180, 180)
}

const clampLatitude = (value: number) => {
  return clampNumber(value, -85, 85)
}

const getSeriesMinMax = (values: number[]) => {
  if (values.length === 0) {
    return { minValue: 0, maxValue: 0 }
  }

  let minValue = values[0]
  let maxValue = values[0]

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < minValue) {
      minValue = values[index]
    } else if (values[index] > maxValue) {
      maxValue = values[index]
    }
  }

  return { minValue, maxValue }
}

const getRouteBoundsCoordinates = (samples: FitnessRouteSample[]) => {
  const initial = samples[0]
  let west = initial.lng
  let east = initial.lng
  let south = initial.lat
  let north = initial.lat

  for (let index = 1; index < samples.length; index += 1) {
    west = Math.min(west, samples[index].lng)
    east = Math.max(east, samples[index].lng)
    south = Math.min(south, samples[index].lat)
    north = Math.max(north, samples[index].lat)
  }

  return {
    west,
    east,
    south,
    north
  }
}

const buildChartPath = (
  values: number[],
  width: number,
  height: number,
  minValue?: number,
  maxValue?: number
) => {
  if (values.length === 0) return ''

  const defaultMinMax = getSeriesMinMax(values)
  const min = typeof minValue === 'number' ? minValue : defaultMinMax.minValue
  const max = typeof maxValue === 'number' ? maxValue : defaultMinMax.maxValue
  const range = Math.max(1, max - min)

  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

const buildXAxisLabels = (
  sampleCount: number,
  durationSeconds: number,
  tickCount = 6
) => {
  const labels: string[] = []
  for (let i = 0; i < tickCount; i++) {
    const ratio = i / (tickCount - 1)
    const seconds = Math.round(ratio * durationSeconds)
    labels.push(formatDuration(seconds))
  }
  return labels
}

const ChartPanel: FC<{
  title: string
  unit: string
  colorClassName?: string
  values: number[]
  minLabel?: string
  maxLabel?: string
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
  showHoverMessage?: boolean
}> = ({
  title,
  unit,
  values,
  colorClassName,
  minLabel,
  maxLabel,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds,
  showHoverMessage = false
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
    () =>
      durationSeconds ? buildXAxisLabels(values.length, durationSeconds) : null,
    [durationSeconds, values.length]
  )
  const canHoverMapPoint =
    typeof onHighlightElapsedSeconds === 'function' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0 &&
    values.length > 0
  const highlightedIndex =
    canHoverMapPoint && typeof highlightedElapsedSeconds === 'number'
      ? clampNumber(
          Math.round(
            (highlightedElapsedSeconds / durationSeconds) * (values.length - 1)
          ),
          0,
          values.length - 1
        )
      : null
  const highlightedValue =
    typeof highlightedIndex === 'number' ? values[highlightedIndex] : null
  const highlightedX =
    typeof highlightedIndex === 'number'
      ? (highlightedIndex / Math.max(1, values.length - 1)) * width
      : null
  const highlightedY =
    typeof highlightedValue === 'number'
      ? getChartYPosition(highlightedValue, height, minValue, maxValue)
      : null
  const highlightedElapsedLabel =
    typeof highlightedElapsedSeconds === 'number'
      ? formatDuration(Math.round(highlightedElapsedSeconds))
      : null

  return (
    <div className="rounded-lg border bg-white/80 p-4">
      <div className="mb-2 flex items-end justify-between">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <p className="text-xs text-slate-500">
          Scale {minScale} - {maxScale}
        </p>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-stretch gap-2">
        <div
          className={cn(
            'flex flex-col justify-between text-[11px] text-slate-500',
            GRAPH_HEIGHT_CLASSNAME
          )}
        >
          <span>{maxScale}</span>
          <span>{minScale}</span>
        </div>
        <div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className={cn(
              'w-full',
              GRAPH_HEIGHT_CLASSNAME,
              canHoverMapPoint && 'cursor-crosshair'
            )}
            onMouseMove={(event) => {
              if (!canHoverMapPoint || !onHighlightElapsedSeconds) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const ratio = clampNumber(
                (event.clientX - bounds.left) / Math.max(bounds.width, 1),
                0,
                1
              )
              onHighlightElapsedSeconds(ratio * durationSeconds)
            }}
            onMouseLeave={() => {
              if (!canHoverMapPoint || !onHighlightElapsedSeconds) return
              onHighlightElapsedSeconds(null)
            }}
          >
            <path
              d={path}
              fill="none"
              className={cn('stroke-[2.5]', colorClassName ?? 'stroke-sky-500')}
            />
            {typeof highlightedX === 'number' &&
            typeof highlightedY === 'number' ? (
              <>
                <line
                  x1={highlightedX}
                  y1={0}
                  x2={highlightedX}
                  y2={height}
                  className="stroke-sky-500 stroke-[1.5] opacity-60"
                />
                <circle
                  cx={highlightedX}
                  cy={highlightedY}
                  r={4.5}
                  className="fill-sky-500 stroke-white stroke-[2]"
                />
              </>
            ) : null}
          </svg>
          {xLabels && (
            <div className="mt-2 flex justify-between text-[11px] text-slate-500">
              {xLabels.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          )}
          {showHoverMessage ? (
            <p className="mt-2 text-xs text-slate-500">
              {highlightedElapsedLabel
                ? `Selected time: ${highlightedElapsedLabel}`
                : 'Hover the chart to follow that time point on the map.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const ActivityMapPanel: FC<{
  mapAttachment?: Attachment
  routeSamples: FitnessRouteSample[]
  routeSegments: FitnessRouteSegment[]
  highlightedElapsedSeconds?: number | null
  mapboxAccessToken?: string
  routeDataError?: string | null
  isRouteDataLoading?: boolean
  onOpenMap?: () => void
  compact?: boolean
}> = ({
  mapAttachment,
  routeSamples,
  routeSegments,
  highlightedElapsedSeconds = null,
  mapboxAccessToken,
  routeDataError = null,
  isRouteDataLoading = false,
  onOpenMap,
  compact = false
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)
  const drawableRouteSegments = useMemo(
    () => routeSegments.filter((segment) => segment.samples.length >= 2),
    [routeSegments]
  )
  const routeSamplesForBounds = useMemo(
    () => drawableRouteSegments.flatMap((segment) => segment.samples),
    [drawableRouteSegments]
  )
  const hasHiddenPrivacySegments = useMemo(
    () => drawableRouteSegments.some((segment) => segment.isHiddenByPrivacy),
    [drawableRouteSegments]
  )

  const shouldRenderInteractiveMap =
    Boolean(mapboxAccessToken) &&
    drawableRouteSegments.length > 0 &&
    !routeDataError &&
    !mapLoadError

  const routeFeatureCollection = useMemo(
    (): MapFeatureCollection<MapLineStringGeometry, RouteLineProperties> => ({
      type: 'FeatureCollection',
      features: drawableRouteSegments.map((segment) => ({
        type: 'Feature',
        properties: {
          isHiddenByPrivacy: segment.isHiddenByPrivacy
        },
        geometry: {
          type: 'LineString',
          coordinates: segment.samples.map((sample) => [sample.lng, sample.lat])
        }
      }))
    }),
    [drawableRouteSegments]
  )

  const activeSample = useMemo(() => {
    if (!shouldRenderInteractiveMap) return null
    if (typeof highlightedElapsedSeconds !== 'number') return null
    return findRouteSampleForElapsed(routeSamples, highlightedElapsedSeconds)
  }, [highlightedElapsedSeconds, routeSamples, shouldRenderInteractiveMap])

  useEffect(() => {
    if (!shouldRenderInteractiveMap || !mapContainerRef.current) {
      mapRef.current?.remove()
      mapRef.current = null
      return
    }

    let cancelled = false

    const initializeMap = async () => {
      try {
        const mapbox = await loadMapboxModule<MapboxModule>()
        if (cancelled || !mapContainerRef.current) return

        setMapLoadError(null)
        mapbox.accessToken = mapboxAccessToken ?? ''

        const map = new mapbox.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/outdoors-v12',
          attributionControl: false
        })

        mapRef.current = map

        map.once('load', () => {
          if (cancelled || !mapRef.current) return

          map.addSource(MAP_ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: routeFeatureCollection
          })

          map.addLayer({
            id: 'activity-route-line-visible',
            type: 'line',
            source: MAP_ROUTE_SOURCE_ID,
            filter: ['==', ['get', 'isHiddenByPrivacy'], false],
            paint: {
              'line-color': '#f97316',
              'line-width': 4,
              'line-opacity': 0.9
            }
          })

          map.addLayer({
            id: 'activity-route-line-hidden',
            type: 'line',
            source: MAP_ROUTE_SOURCE_ID,
            filter: ['==', ['get', 'isHiddenByPrivacy'], true],
            paint: {
              'line-color': '#16a34a',
              'line-width': 4,
              'line-opacity': 0.95
            }
          })

          map.addSource(MAP_ACTIVE_POINT_SOURCE_ID, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            }
          })

          map.addLayer({
            id: 'activity-active-point-ring',
            type: 'circle',
            source: MAP_ACTIVE_POINT_SOURCE_ID,
            paint: {
              'circle-radius': 8,
              'circle-color': '#ffffff',
              'circle-opacity': 0.95
            }
          })

          map.addLayer({
            id: 'activity-active-point-core',
            type: 'circle',
            source: MAP_ACTIVE_POINT_SOURCE_ID,
            paint: {
              'circle-radius': 4.5,
              'circle-color': [
                'case',
                ['==', ['get', 'isHiddenByPrivacy'], true],
                '#16a34a',
                '#1d4ed8'
              ]
            }
          })

          const routeBoundsCoordinates = getRouteBoundsCoordinates(
            routeSamplesForBounds
          )
          const routeBounds = new mapbox.LngLatBounds(
            [routeBoundsCoordinates.west, routeBoundsCoordinates.south],
            [routeBoundsCoordinates.east, routeBoundsCoordinates.north]
          )

          map.fitBounds(routeBounds, {
            padding: compact ? 28 : 40,
            maxZoom: 16,
            duration: 0
          })

          // Keep full route visible as the widest zoom-out level.
          map.setMinZoom(map.getZoom())

          const lngSpan = Math.max(
            routeBoundsCoordinates.east - routeBoundsCoordinates.west,
            0.005
          )
          const latSpan = Math.max(
            routeBoundsCoordinates.north - routeBoundsCoordinates.south,
            0.005
          )
          const lngPadding = Math.max(lngSpan * 0.2, 0.002)
          const latPadding = Math.max(latSpan * 0.2, 0.002)

          // Limit panning to the route vicinity.
          map.setMaxBounds(
            new mapbox.LngLatBounds(
              [
                clampLongitude(routeBoundsCoordinates.west - lngPadding),
                clampLatitude(routeBoundsCoordinates.south - latPadding)
              ],
              [
                clampLongitude(routeBoundsCoordinates.east + lngPadding),
                clampLatitude(routeBoundsCoordinates.north + latPadding)
              ]
            )
          )
        })
      } catch (_error) {
        if (cancelled) return
        mapRef.current?.remove()
        mapRef.current = null
        setMapLoadError('Interactive map unavailable. Using static preview.')
      }
    }

    void initializeMap()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [
    compact,
    mapboxAccessToken,
    routeFeatureCollection,
    routeSamplesForBounds,
    shouldRenderInteractiveMap
  ])

  useEffect(() => {
    if (!shouldRenderInteractiveMap) return

    const map = mapRef.current
    if (!map) return

    const source = map.getSource(MAP_ACTIVE_POINT_SOURCE_ID) as
      | MapboxGeoJSONSource
      | undefined
    if (!source) return

    if (!activeSample) {
      source.setData({
        type: 'FeatureCollection',
        features: []
      })
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            isHiddenByPrivacy: Boolean(activeSample.isHiddenByPrivacy)
          },
          geometry: {
            type: 'Point',
            coordinates: [activeSample.lng, activeSample.lat]
          }
        }
      ]
    })
  }, [activeSample, shouldRenderInteractiveMap])

  return (
    <div
      className={cn(
        'relative overflow-hidden border border-slate-300 bg-slate-100',
        compact ? 'h-56 rounded-lg' : 'h-80 rounded-none'
      )}
    >
      {shouldRenderInteractiveMap ? (
        <div ref={mapContainerRef} className="h-full w-full" />
      ) : mapAttachment ? (
        <button
          type="button"
          onClick={onOpenMap}
          className="block h-full w-full cursor-pointer"
        >
          <Media
            attachment={mapAttachment}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-sm text-slate-600">
          Map preview unavailable
        </div>
      )}

      {shouldRenderInteractiveMap ? (
        <>
          <div className="absolute left-3 top-3 flex flex-col overflow-hidden rounded-md border border-slate-300 bg-white/95 shadow-sm">
            <button
              type="button"
              onClick={() => {
                mapRef.current?.zoomIn({ duration: 250 })
              }}
              className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-100"
              aria-label="Zoom in map"
            >
              <Plus className="size-4" />
            </button>
            <div className="h-px bg-slate-300" />
            <button
              type="button"
              onClick={() => {
                mapRef.current?.zoomOut({ duration: 250 })
              }}
              className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-100"
              aria-label="Zoom out map"
            >
              <span className="text-base leading-none">-</span>
            </button>
          </div>
          <div className="absolute right-3 top-3 rounded-md border border-slate-300 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
            Mapbox
          </div>
          {hasHiddenPrivacySegments ? (
            <div className="absolute bottom-3 left-3 rounded-md border border-green-300 bg-white/95 px-3 py-2 text-xs font-medium text-green-700 shadow-sm">
              Green segments are hidden from other viewers
            </div>
          ) : null}
        </>
      ) : onOpenMap && mapAttachment ? (
        <button
          type="button"
          onClick={onOpenMap}
          className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-md bg-orange-600 text-white shadow"
          aria-label="Open route map image"
        >
          <Play className="size-5" />
        </button>
      ) : null}

      {!shouldRenderInteractiveMap &&
      isRouteDataLoading &&
      mapboxAccessToken ? (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-slate-300 bg-white/95 px-3 py-1 text-xs text-slate-700 shadow-sm">
          Loading interactive route...
        </div>
      ) : null}

      {!shouldRenderInteractiveMap && (routeDataError || mapLoadError) ? (
        <div className="absolute left-3 right-3 top-3 rounded-md border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-sm">
          {routeDataError || mapLoadError}
        </div>
      ) : null}
    </div>
  )
}

const ActivityGallery: FC<{
  attachments: Attachment[]
  onOpenAttachment: (index: number) => void
}> = ({ attachments, onOpenAttachment }) => {
  if (attachments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        No additional media for this activity.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {attachments.slice(0, 6).map((attachment, index) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onOpenAttachment(index)}
          className="relative aspect-video overflow-hidden rounded-md border border-slate-300 transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          aria-label={`Open media ${index + 1}`}
        >
          <Media
            attachment={attachment}
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  )
}

const MetricCard: FC<{ label: string; value: string; highlight?: boolean }> = ({
  label,
  value,
  highlight = false
}) => {
  const match = value.match(/^([\d:.,]+)\s*(.*)$/)
  const numericValue = match ? match[1] : value
  const unit = match && match[2] ? match[2] : ''

  return (
    <div className="flex min-w-0 flex-col justify-center rounded-sm px-4 py-3">
      <p
        className={cn(
          'truncate whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl md:text-4xl',
          highlight && 'text-orange-600'
        )}
      >
        {numericValue}
      </p>
      <p className="mt-1 truncate whitespace-nowrap text-xs font-medium text-slate-500 sm:text-sm">
        {label}{unit ? ` (${unit})` : ''}
      </p>
    </div>
  )
}

export const FitnessStatusDetail: FC<Props> = ({
  mapboxAccessToken,
  currentActor,
  status,
  onShowAttachment
}) => {
  const [activeSection, setActiveSection] = useState<SectionKey>('overview')
  const [analysisGraphFilter, setAnalysisGraphFilter] =
    useState<AnalysisGraphFilter>('all')

  const defaultFitnessFiles = useMemo<StatusFitnessFileItem[]>(() => {
    if (!status.fitness) {
      return []
    }

    return [
      {
        id: status.fitness.id,
        actorId: status.actorId,
        fileName: status.fitness.fileName,
        fileType: status.fitness.fileType,
        statusId: status.id,
        isPrimary: true,
        processingStatus: status.fitness.processingStatus ?? 'pending',
        totalDistanceMeters: status.fitness.totalDistanceMeters ?? null,
        totalDurationSeconds: status.fitness.totalDurationSeconds ?? null,
        elevationGainMeters: status.fitness.elevationGainMeters ?? null,
        activityType: status.fitness.activityType ?? null,
        activityStartTime: status.createdAt,
        hasMapData: status.fitness.hasMapData ?? false,
        description: status.fitness.description ?? null
      }
    ]
  }, [
    status.actorId,
    status.createdAt,
    status.id,
    status.fitness?.id,
    status.fitness?.fileName,
    status.fitness?.fileType,
    status.fitness?.processingStatus,
    status.fitness?.totalDistanceMeters,
    status.fitness?.totalDurationSeconds,
    status.fitness?.elevationGainMeters,
    status.fitness?.activityType,
    status.fitness?.hasMapData,
    status.fitness?.description
  ])
  const [fitnessFiles, setFitnessFiles] =
    useState<StatusFitnessFileItem[]>(defaultFitnessFiles)
  const [selectedFitnessFileId, setSelectedFitnessFileId] = useState<
    string | null
  >(defaultFitnessFiles[0]?.id ?? null)
  const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
    null
  )
  const [routeSamples, setRouteSamples] = useState<FitnessRouteSample[]>([])
  const [routeSegments, setRouteSegments] = useState<FitnessRouteSegment[]>([])
  const [powerSeries, setPowerSeries] = useState<number[]>([])
  const [heartRateSeries, setHeartRateSeries] = useState<number[]>([])
  const [altitudeSeries, setAltitudeSeries] = useState<number[]>([])
  const [speedSeries, setSpeedSeries] = useState<number[]>([])
  const [routeDataError, setRouteDataError] = useState<string | null>(null)
  const [isRouteDataLoading, setIsRouteDataLoading] = useState(false)
  const [highlightedElapsedSeconds, setHighlightedElapsedSeconds] = useState<
    number | null
  >(null)

  useEffect(() => {
    setFitnessFiles(defaultFitnessFiles)
    setSelectedFitnessFileId(defaultFitnessFiles[0]?.id ?? null)
  }, [defaultFitnessFiles])

  useEffect(() => {
    let cancelled = false

    const loadFitnessFiles = async () => {
      try {
        const response = await fetch(
          `/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(
            status.id
          )}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json'
            }
          }
        )
        if (!response.ok) {
          // Keep the status payload fallback if the list endpoint is unavailable.
          return
        }

        const data = (await response.json()) as FitnessFilesByStatusResponse
        if (
          cancelled ||
          !Array.isArray(data.files) ||
          data.files.length === 0
        ) {
          return
        }

        const ordered = [...data.files].sort((first, second) => {
          const firstStart = first.activityStartTime ?? Number.MAX_SAFE_INTEGER
          const secondStart =
            second.activityStartTime ?? Number.MAX_SAFE_INTEGER

          if (firstStart !== secondStart) {
            return firstStart - secondStart
          }

          if (first.fileName !== second.fileName) {
            return first.fileName.localeCompare(second.fileName)
          }

          return first.id.localeCompare(second.id)
        })

        setFitnessFiles(ordered)
        setSelectedFitnessFileId((current) => {
          if (current && ordered.some((item) => item.id === current)) {
            return current
          }
          return ordered.find((item) => item.isPrimary)?.id ?? ordered[0].id
        })
      } catch {
        // Keep the status payload fallback if the list endpoint is unavailable.
      }
    }

    void loadFitnessFiles()

    return () => {
      cancelled = true
    }
  }, [status.id])

  const actorName = status.actor?.name || status.actor?.username || 'Athlete'
  const fitness = useMemo(
    () =>
      fitnessFiles.find((item) => item.id === selectedFitnessFileId) ??
      fitnessFiles[0],
    [fitnessFiles, selectedFitnessFileId]
  )
  const shouldLoadInteractiveMap = Boolean(mapboxAccessToken && fitness?.id)
  const activityLabel = getActivityLabel(fitness?.activityType ?? undefined)
  const statusTitle = status.text.trim() || `${activityLabel} workout`
  const activityDate = formatUtcDate(
    status.createdAt,
    'p \u2022 EEEE, MMMM d, yyyy'
  )

  const paceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitness?.totalDistanceMeters ?? undefined,
    durationSeconds: fitness?.totalDurationSeconds ?? undefined,
    activityType: fitness?.activityType ?? undefined
  })

  const mapAttachmentIndex = useMemo(() => {
    const routeMapIndex = status.attachments.findIndex((attachment) =>
      attachment.name.toLowerCase().includes('route map')
    )

    if (routeMapIndex >= 0) return routeMapIndex
    if (fitness?.hasMapData && status.attachments.length > 0) return 0
    return -1
  }, [fitness?.hasMapData, status.attachments])

  const mapAttachment =
    mapAttachmentIndex >= 0 ? status.attachments[mapAttachmentIndex] : undefined

  const shouldRenderMapPanel =
    !!mapAttachment ||
    fitness?.hasMapData ||
    isRouteDataLoading ||
    routeSegments.length > 0

  const mediaWithoutMap = status.attachments.filter(
    (_, index) => index !== mapAttachmentIndex
  )

  useEffect(() => {
    setRouteSamples([])
    setRouteSegments([])
    setPowerSeries([])
    setHeartRateSeries([])
    setAltitudeSeries([])
    setSpeedSeries([])
    setRouteDataError(null)

    if (!shouldLoadInteractiveMap || !fitness?.id) {
      setIsRouteDataLoading(false)
      return
    }

    let cancelled = false

    const loadRouteSamples = async () => {
      try {
        setIsRouteDataLoading(true)

        const response = await fetch(
          `/api/v1/fitness-files/${fitness.id}/route-data`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json'
            }
          }
        )

        if (!response.ok) {
          throw new Error(`Route data request failed (${response.status})`)
        }

        const data = (await response.json()) as FitnessRouteDataResponse

        if (cancelled) return

        if (!Array.isArray(data.samples)) {
          throw new Error('Route data response is invalid')
        }

        const normalizedSamples = data.samples.map((sample) =>
          normalizeRouteSample(sample)
        )
        const normalizedSegments = normalizeRouteSegments({
          samples: normalizedSamples,
          segments: data.segments
        })

        setRouteSamples(normalizedSamples)
        setRouteSegments(normalizedSegments)
        setPowerSeries(data.powerSeries ?? [])
        setHeartRateSeries(data.heartRateSeries ?? [])
        setAltitudeSeries(data.altitudeSeries ?? [])
        setSpeedSeries(data.speedSeries ?? [])
      } catch (_error) {
        if (cancelled) return
        setRouteSamples([])
        setRouteSegments([])
        setPowerSeries([])
        setHeartRateSeries([])
        setAltitudeSeries([])
        setSpeedSeries([])
        setRouteDataError('Interactive map unavailable. Using static preview.')
      } finally {
        if (!cancelled) {
          setIsRouteDataLoading(false)
        }
      }
    }

    void loadRouteSamples()

    return () => {
      cancelled = true
    }
  }, [fitness?.id, shouldLoadInteractiveMap])

  useEffect(() => {
    if (activeSection !== 'analysis') {
      setHighlightedElapsedSeconds(null)
    }
  }, [activeSection])

  const distanceMeters = fitness?.totalDistanceMeters ?? 0
  const durationSeconds = fitness?.totalDurationSeconds ?? 0
  const elevationGainMeters = fitness?.elevationGainMeters ?? 0

  const avgPower = useMemo(() => {
    if (powerSeries.length === 0) return null
    return Math.round(
      powerSeries.reduce((a, b) => a + b, 0) / powerSeries.length
    )
  }, [powerSeries])

  const totalWorkKj = useMemo(() => {
    if (!avgPower || durationSeconds <= 0) return null
    return Math.round((avgPower * durationSeconds) / 1000)
  }, [avgPower, durationSeconds])

  const activitySeries = useMemo(() => {
    return {
      heartRate:
        heartRateSeries.length > 0 ? downsampleSeries(heartRateSeries, 120) : [],
      power: powerSeries.length > 0 ? downsampleSeries(powerSeries, 120) : [],
      speed: speedSeries.length > 0 ? downsampleSeries(speedSeries, 120) : [],
      elevation:
        altitudeSeries.length > 0 ? downsampleSeries(altitudeSeries, 120) : []
    }
  }, [heartRateSeries, powerSeries, speedSeries, altitudeSeries])
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

  const histogramMinutes = useMemo(() => {
    if (powerSeries.length === 0) return []

    const maxPower = Math.max(...powerSeries, 100)
    const bucketCount = Math.ceil((maxPower + 25) / 25)

    const buckets = new Array(bucketCount).fill(0)
    // Actual power data represents samples (usually 1 per second)
    for (const p of powerSeries) {
      const bucketIndex = Math.floor(p / 25)
      if (bucketIndex >= 0 && bucketIndex < bucketCount) {
        buckets[bucketIndex] += 1
      }
    }
    // Convert samples (seconds) to minutes
    return buckets.map((seconds) => seconds / 60)
  }, [powerSeries])

  const histogramLayout = useMemo(() => {
    const histogramViewHeight = GRAPH_VIEW_HEIGHT
    const histogramTopPadding = 24 // More padding for the average power label
    const histogramHeight = histogramViewHeight - histogramTopPadding
    const barCount = histogramMinutes.length
    const barGap = 2
    const totalGaps = (barCount - 1) * barGap
    const barWidth = (760 - totalGaps) / Math.max(1, barCount)
    const maxValue = Math.max(...histogramMinutes, 1)

    // Calculate weighted average line position
    const weightedAvgPowerValue = avgPower ?? 0
    const weightedAvgX = (weightedAvgPowerValue / 25) * (barWidth + barGap)

    // Y-axis grid lines (4 intervals)
    const yAxisTicks = Array.from({ length: 5 }, (_, i) => {
      const valueMinutes = (maxValue / 4) * i
      const y =
        histogramViewHeight - (valueMinutes / maxValue) * histogramHeight
      return {
        y,
        label:
          valueMinutes === 0
            ? '0s'
            : formatDuration(Math.round(valueMinutes * 60))
      }
    })

    return {
      histogramViewHeight,
      histogramTopPadding,
      histogramHeight,
      barCount,
      barGap,
      barWidth,
      maxValue,
      weightedAvgPowerValue,
      weightedAvgX,
      yAxisTicks
    }
  }, [avgPower, histogramMinutes])

  const getBarColor = (index: number, total: number) => {
    const ratio = index / Math.max(1, total - 1)
    // Interpolate between light pink (#f4e6ec) and dark purple (#804374)
    const r1 = 244,
      g1 = 230,
      b1 = 236
    const r2 = 128,
      g2 = 67,
      b2 = 116
    const r = Math.round(r1 + (r2 - r1) * ratio)
    const g = Math.round(g1 + (g2 - g1) * ratio)
    const b = Math.round(b1 + (b2 - b1) * ratio)
    return `rgb(${r}, ${g}, ${b})`
  }

  const navItems = useMemo(() => {
    const items = [...NAV_ITEMS]
    if (powerSeries.length === 0) {
      return items.filter((item) => item.id !== '25w-distribution')
    }
    return items
  }, [powerSeries])

  return (
    <div>
      <nav
        className="overflow-x-auto border-b border-border bg-[#f7f7f8]"
        aria-label="Activity sections"
      >
        <ul className="flex min-w-max" role="tablist">
          {navItems
            .filter((item) => !item.group)
            .map((item) => (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSection === item.id}
                  aria-controls={`panel-${item.id}`}
                  id={`tab-${item.id}`}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'inline-block cursor-pointer whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500',
                    activeSection === item.id
                      ? 'border-b-2 border-primary text-primary'
                      : 'border-b-2 border-transparent text-muted-foreground'
                  )}
                >
                  {item.label}
                </button>
              </li>
            ))}
          <li className="flex items-center px-2" aria-hidden="true">
            <span className="h-4 w-px bg-border" />
          </li>
          {navItems
            .filter((item) => item.group === 'subscription')
            .map((item) => (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSection === item.id}
                  aria-controls={`panel-${item.id}`}
                  id={`tab-${item.id}`}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'inline-block cursor-pointer whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500',
                    activeSection === item.id
                      ? 'border-b-2 border-primary text-primary'
                      : 'border-b-2 border-transparent text-muted-foreground'
                  )}
                >
                  {item.label}
                </button>
              </li>
            ))}
        </ul>
      </nav>

      <section className="bg-[#f4f4f6]">
        <div className="border-b border-slate-300 bg-[#f7f7f8] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-orange-100 text-orange-600">
                {getActivityIcon(fitness?.activityType ?? undefined)}
              </span>
              <div className="min-w-0 flex-1">
                <h1
                  className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl md:text-4xl"
                  title={`${actorName} - ${activityLabel}`}
                >
                  {actorName} - {activityLabel}
                </h1>
                <p className="mt-1 truncate text-xs text-slate-500 sm:text-sm">
                  {activityDate}
                </p>
                <h2
                  className="mt-2 truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl md:text-3xl"
                  title={statusTitle}
                >
                  {statusTitle}
                </h2>
                {fitnessFiles.length > 1 && (
                  <div className="mt-3 flex items-center gap-2">
                    <label
                      htmlFor="activity-file-select"
                      className="text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Activity File
                    </label>
                    <select
                      id="activity-file-select"
                      value={selectedFitnessFileId ?? ''}
                      onChange={(e) => setSelectedFitnessFileId(e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    >
                      {fitnessFiles.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.fileName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
            {currentActor?.id === status.actorId && (
              <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                <VisibilityButton status={status} />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-y-1 border-b border-slate-300 bg-[#f0f1f3] px-2 py-2 sm:grid-cols-3">
          <MetricCard label="Distance" value={formatDistance(distanceMeters)} />
          <MetricCard
            label="Moving Time"
            value={formatDuration(durationSeconds)}
          />
          <MetricCard
            label="Elevation"
            value={`${Math.max(0, Math.round(elevationGainMeters))} m`}
          />
          <MetricCard
            label={paceOrSpeed?.label ?? 'Avg speed'}
            value={paceOrSpeed?.value ?? '0.0 km/h'}
          />
          {avgPower !== null && (
            <MetricCard label="Avg Power" value={`${avgPower} w`} />
          )}
          {totalWorkKj !== null && (
            <MetricCard label="Total Work" value={`${totalWorkKj} kJ`} />
          )}
        </div>

        {shouldRenderMapPanel && (
          <ActivityMapPanel
            mapAttachment={mapAttachment}
            routeSamples={routeSamples}
            routeSegments={routeSegments}
            highlightedElapsedSeconds={highlightedElapsedSeconds}
            mapboxAccessToken={mapboxAccessToken}
            routeDataError={routeDataError}
            isRouteDataLoading={isRouteDataLoading}
            onOpenMap={() => {
              if (mapAttachmentIndex >= 0) {
                onShowAttachment(status.attachments, mapAttachmentIndex)
              }
            }}
          />
        )}

        <div
          id="panel-overview"
          role="tabpanel"
          aria-labelledby="tab-overview"
          tabIndex={0}
          className={cn(
            'focus-visible:outline-none',
            activeSection !== 'overview' && 'hidden'
          )}
        >
          <div className="space-y-6 p-4 sm:p-6">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-slate-900">Media</h3>
              <ActivityGallery
                attachments={mediaWithoutMap}
                onOpenAttachment={(index) => {
                  const target = status.attachments.findIndex(
                    (attachment) => attachment.id === mediaWithoutMap[index]?.id
                  )
                  if (target >= 0) {
                    onShowAttachment(status.attachments, target)
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div
          id="panel-analysis"
          role="tabpanel"
          aria-labelledby="tab-analysis"
          tabIndex={0}
          className={cn(
            'focus-visible:outline-none',
            activeSection !== 'analysis' && 'hidden'
          )}
        >
          <div className="space-y-4 p-4 sm:p-6">
            <div className="rounded-lg border bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Graph display
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ANALYSIS_GRAPH_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={analysisGraphFilter === option.id}
                    onClick={() => setAnalysisGraphFilter(option.id)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      analysisGraphFilter === option.id
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {highlightedElapsedLabel
                  ? `Selected time: ${highlightedElapsedLabel}`
                  : 'Hover any graph below to follow that time point on the map.'}
              </p>
            </div>

              {(analysisGraphFilter === 'all' ||
                analysisGraphFilter === 'elevation') && (
                <ChartPanel
                  title="Elevation profile"
                  unit="m"
                  values={activitySeries.elevation}
                  colorClassName="stroke-slate-400"
                  minLabel={elevationMin.toFixed(0)}
                  maxLabel={elevationMax.toFixed(0)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={analysisGraphFilter !== 'all'}
                />
              )}

              {(analysisGraphFilter === 'all' ||
                analysisGraphFilter === 'speed') && (
                <ChartPanel
                  title="Speed"
                  unit="km/h"
                  values={activitySeries.speed}
                  colorClassName="stroke-sky-500"
                  minLabel={speedMin.toFixed(1)}
                  maxLabel={speedMax.toFixed(1)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={analysisGraphFilter !== 'all'}
                />
              )}

              {(analysisGraphFilter === 'all' ||
                analysisGraphFilter === 'power') && (
                <ChartPanel
                  title="Power"
                  unit="w"
                  values={activitySeries.power}
                  colorClassName="stroke-violet-500"
                  minLabel={powerMin.toFixed(0)}
                  maxLabel={powerMax.toFixed(0)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={analysisGraphFilter !== 'all'}
                />
              )}

              {(analysisGraphFilter === 'all' ||
                analysisGraphFilter === 'heart-rate') && (
                <ChartPanel
                  title="Heart rate"
                  unit="bpm"
                  values={activitySeries.heartRate}
                  colorClassName="stroke-rose-500"
                  minLabel={heartRateMin.toFixed(0)}
                  maxLabel={heartRateMax.toFixed(0)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={analysisGraphFilter !== 'all'}
                />
              )}
            </div>
        </div>

        <div
          id="panel-25w-distribution"
          role="tabpanel"
          aria-labelledby="tab-25w-distribution"
          tabIndex={0}
          className={cn(
            'focus-visible:outline-none',
            activeSection !== '25w-distribution' && 'hidden'
          )}
        >
          <div className="space-y-4 p-4 sm:p-6">
            <h3 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl md:text-5xl">
              25W Power Distribution
            </h3>
            <div className="rounded-sm border border-slate-300 bg-white p-4">
              <div className="grid grid-cols-[auto_1fr] items-stretch gap-4">
                <div
                  className={cn(
                    'flex flex-col justify-between text-[11px] text-slate-400 py-1',
                    GRAPH_HEIGHT_CLASSNAME
                  )}
                >
                  {histogramLayout.yAxisTicks
                    .slice()
                    .reverse()
                    .map((tick, i) => (
                      <span key={`y-tick-${i}`} className="text-right pr-2">
                        {tick.label}
                      </span>
                    ))}
                </div>
                <div className="min-w-0 relative pt-1">
                  <svg
                    viewBox={`0 0 760 ${histogramLayout.histogramViewHeight}`}
                    preserveAspectRatio="none"
                    className={cn('w-full', GRAPH_HEIGHT_CLASSNAME)}
                  >
                    {/* Grid lines */}
                    {histogramLayout.yAxisTicks.map((tick, i) => (
                      <line
                        key={`grid-${i}`}
                        x1="0"
                        y1={tick.y}
                        x2="760"
                        y2={tick.y}
                        className="stroke-slate-100 stroke-[1]"
                      />
                    ))}

                    {/* Bars */}
                    {histogramMinutes.map((value, index) => {
                      const x =
                        index *
                        (histogramLayout.barWidth + histogramLayout.barGap)
                      const barHeight =
                        (value / histogramLayout.maxValue) *
                        histogramLayout.histogramHeight
                      const y = histogramLayout.histogramViewHeight - barHeight
                      const isHovered = hoveredBucketIndex === index

                      return (
                        <rect
                          key={`bar-${index}`}
                          x={x}
                          y={y}
                          width={histogramLayout.barWidth}
                          height={barHeight}
                          fill={getBarColor(index, histogramLayout.barCount)}
                          className={cn(
                            'transition-opacity cursor-crosshair',
                            hoveredBucketIndex !== null && !isHovered
                              ? 'opacity-40'
                              : 'opacity-100'
                          )}
                          onMouseMove={() => setHoveredBucketIndex(index)}
                          onMouseLeave={() => setHoveredBucketIndex(null)}
                        />
                      )
                    })}

                    {/* Hover Tooltip */}
                    {hoveredBucketIndex !== null &&
                      (() => {
                        const value = histogramMinutes[hoveredBucketIndex]
                        const totalMinutes = histogramMinutes.reduce(
                          (a, b) => a + b,
                          0
                        )
                        const percentage =
                          totalMinutes > 0 ? (value / totalMinutes) * 100 : 0
                        const powerRange = `${hoveredBucketIndex * 25}-${
                          (hoveredBucketIndex + 1) * 25
                        }W`

                        // Tooltip positioning
                        const tooltipWidth = 140
                        const tooltipHeight = 60
                        let tooltipX =
                          hoveredBucketIndex *
                            (histogramLayout.barWidth +
                              histogramLayout.barGap) +
                          histogramLayout.barWidth / 2 -
                          tooltipWidth / 2
                        // Keep within bounds
                        tooltipX = Math.max(
                          0,
                          Math.min(760 - tooltipWidth, tooltipX)
                        )
                        const tooltipY = Math.max(
                          0,
                          histogramLayout.histogramViewHeight -
                            (value / histogramLayout.maxValue) *
                              histogramLayout.histogramHeight -
                            tooltipHeight -
                            10
                        )

                        return (
                          <g
                            transform={`translate(${tooltipX}, ${tooltipY})`}
                            className="pointer-events-none"
                          >
                            <rect
                              width={tooltipWidth}
                              height={tooltipHeight}
                              rx="4"
                              className="fill-slate-900/90"
                            />
                            <text
                              x={tooltipWidth / 2}
                              y="20"
                              textAnchor="middle"
                              className="fill-white text-[11px] font-bold"
                            >
                              {powerRange}
                            </text>
                            <text
                              x={tooltipWidth / 2}
                              y="38"
                              textAnchor="middle"
                              className="fill-slate-300 text-[11px]"
                            >
                              {formatDuration(Math.round(value * 60))} (
                              {percentage.toFixed(1)}%)
                            </text>
                          </g>
                        )
                      })()}

                    {/* Weighted Average Line */}
                    <line
                      x1={histogramLayout.weightedAvgX}
                      y1={histogramLayout.histogramTopPadding}
                      x2={histogramLayout.weightedAvgX}
                      y2={histogramLayout.histogramViewHeight}
                      stroke="#a65e92"
                      strokeWidth="1.5"
                      strokeDasharray="4,4"
                    />
                    <text
                      x={Math.min(
                        Math.max(histogramLayout.weightedAvgX, 80),
                        680
                      )}
                      y={histogramLayout.histogramTopPadding - 6}
                      textAnchor="middle"
                      fill="#a65e92"
                      fontSize="12"
                      className="font-medium"
                    >
                      Average Power {histogramLayout.weightedAvgPowerValue} W
                    </text>
                  </svg>

                  {/* X-Axis labels */}
                  <div className="mt-2 flex text-[11px] text-slate-400 border-t border-slate-200 pt-2 relative h-6">
                    {histogramMinutes.map((_, index) => {
                      // Show label at start of bucket, only every 50W (index % 2 === 0)
                      if (index % 2 !== 0) return null

                      const leftPercent =
                        (index / histogramLayout.barCount) * 100
                      return (
                        <span
                          key={`label-${index}`}
                          className="absolute"
                          style={{ left: `${leftPercent}%` }}
                        >
                          {index * 25} W
                        </span>
                      )
                    })}
                    {/* Final label at the end */}
                    <span className="absolute right-0 text-right">
                      {histogramLayout.barCount * 25} W
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
