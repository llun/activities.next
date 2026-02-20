'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'
import { Bike, Play, Plus } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

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

interface Props {
  host: string
  mapboxAccessToken?: string
  currentActor?: ActorProfile | null
  status: StatusNote
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
}

type SectionKey =
  | 'overview'
  | 'analysis'
  | 'heart-rate'
  | 'power-curve'
  | 'zone-distribution'
  | '25w-distribution'
  | 'best-efforts'
  | 'matched-activities'

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
}

interface FitnessRouteDataResponse {
  samples: FitnessRouteSample[]
  totalDurationSeconds: number
}

interface MapPointGeometry {
  type: 'Point'
  coordinates: [number, number]
}

interface MapLineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

interface MapFeature<TGeometry> {
  type: 'Feature'
  properties: Record<string, never>
  geometry: TGeometry
}

interface MapFeatureCollection<TGeometry> {
  type: 'FeatureCollection'
  features: Array<MapFeature<TGeometry>>
}

type MapGeoJSONFeatureCollection =
  | MapFeatureCollection<MapPointGeometry>
  | MapFeatureCollection<MapLineStringGeometry>

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
  { id: 'heart-rate', label: 'Heart Rate', group: 'subscription' },
  { id: 'power-curve', label: 'Power Curve', group: 'subscription' },
  {
    id: 'zone-distribution',
    label: 'Zone Distribution',
    group: 'subscription'
  },
  { id: '25w-distribution', label: '25 W Distribution', group: 'subscription' },
  { id: 'best-efforts', label: 'Best Efforts' },
  { id: 'matched-activities', label: 'Matched Activities' }
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

const createSeededGenerator = (seedText: string) => {
  let seed = 0
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0
  }

  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
}

const GRAPH_VIEW_HEIGHT = 250
const GRAPH_HEIGHT_CLASSNAME = 'h-[190px] lg:h-[250px]'
const MAP_ROUTE_SOURCE_ID = 'activity-route'
const MAP_ACTIVE_POINT_SOURCE_ID = 'activity-active-point'
const MAPBOX_JS_SRC = 'https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.js'
const MAPBOX_CSS_HREF =
  'https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css'

let mapboxModulePromise: Promise<MapboxModule> | null = null

const loadMapboxModule = async (): Promise<MapboxModule> => {
  if (typeof window === 'undefined') {
    throw new Error('Mapbox can only be loaded in a browser')
  }

  const globalWindow = window as Window & { mapboxgl?: MapboxModule }

  if (globalWindow.mapboxgl) {
    return globalWindow.mapboxgl
  }

  if (!mapboxModulePromise) {
    mapboxModulePromise = new Promise<MapboxModule>((resolve, reject) => {
      const onLoaded = () => {
        if (globalWindow.mapboxgl) {
          resolve(globalWindow.mapboxgl)
          return
        }
        reject(new Error('Mapbox global was not initialized'))
      }

      if (!document.querySelector('[data-mapbox-gl-css="true"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = MAPBOX_CSS_HREF
        link.setAttribute('data-mapbox-gl-css', 'true')
        document.head.appendChild(link)
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        '[data-mapbox-gl-script="true"]'
      )

      if (existingScript) {
        existingScript.addEventListener('load', onLoaded, { once: true })
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Failed to load Mapbox script')),
          { once: true }
        )
        return
      }

      const script = document.createElement('script')
      script.src = MAPBOX_JS_SRC
      script.async = true
      script.setAttribute('data-mapbox-gl-script', 'true')
      script.addEventListener('load', onLoaded, { once: true })
      script.addEventListener(
        'error',
        () => reject(new Error('Failed to load Mapbox script')),
        { once: true }
      )

      document.head.appendChild(script)
    })
  }

  return mapboxModulePromise
}

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

  const min =
    typeof minValue === 'number'
      ? minValue
      : Math.min(...values, Number.POSITIVE_INFINITY)
  const max =
    typeof maxValue === 'number'
      ? maxValue
      : Math.max(...values, Number.NEGATIVE_INFINITY)
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
}> = ({
  title,
  unit,
  values,
  colorClassName,
  minLabel,
  maxLabel,
  durationSeconds
}) => {
  const width = 760
  const height = GRAPH_VIEW_HEIGHT
  const path = useMemo(() => buildChartPath(values, width, height), [values])
  const minScale = minLabel ? `${minLabel} ${unit}` : `-- ${unit}`
  const maxScale = maxLabel ? `${maxLabel} ${unit}` : `-- ${unit}`
  const xLabels = useMemo(
    () =>
      durationSeconds ? buildXAxisLabels(values.length, durationSeconds) : null,
    [durationSeconds, values.length]
  )

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
            className={cn('w-full', GRAPH_HEIGHT_CLASSNAME)}
          >
            <path
              d={path}
              fill="none"
              className={cn('stroke-[2.5]', colorClassName ?? 'stroke-sky-500')}
            />
          </svg>
          {xLabels && (
            <div className="mt-2 flex justify-between text-[11px] text-slate-500">
              {xLabels.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ActivityMapPanel: FC<{
  mapAttachment?: Attachment
  routeSamples: FitnessRouteSample[]
  highlightedElapsedSeconds?: number | null
  mapboxAccessToken?: string
  routeDataError?: string | null
  isRouteDataLoading?: boolean
  onOpenMap?: () => void
  compact?: boolean
}> = ({
  mapAttachment,
  routeSamples,
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

  const shouldRenderInteractiveMap =
    Boolean(mapboxAccessToken) &&
    routeSamples.length >= 2 &&
    !routeDataError &&
    !mapLoadError

  const routeFeatureCollection = useMemo(
    (): MapFeatureCollection<MapLineStringGeometry> => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: routeSamples.map((sample) => [sample.lng, sample.lat])
          }
        }
      ]
    }),
    [routeSamples]
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
        const mapbox = await loadMapboxModule()
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
            id: 'activity-route-line',
            type: 'line',
            source: MAP_ROUTE_SOURCE_ID,
            paint: {
              'line-color': '#f97316',
              'line-width': 4,
              'line-opacity': 0.9
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
              'circle-color': '#1d4ed8'
            }
          })

          const routeBoundsCoordinates = getRouteBoundsCoordinates(routeSamples)
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
    routeSamples,
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
          properties: {},
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
    <div className="grid grid-cols-3 gap-2">
      {attachments.slice(0, 6).map((attachment, index) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onOpenAttachment(index)}
          className="relative aspect-video overflow-hidden rounded-md border border-slate-300"
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
  return (
    <div className="min-w-0 rounded-sm px-4 py-3">
      <p
        className={cn(
          'break-words text-[clamp(1.75rem,4vw,2.25rem)] font-semibold leading-tight tracking-tight text-slate-900',
          highlight && 'text-orange-600'
        )}
      >
        {value}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-slate-500">
        {label}
      </p>
    </div>
  )
}

export const FitnessStatusDetail: FC<Props> = ({
  mapboxAccessToken,
  status,
  onShowAttachment
}) => {
  const [activeSection, setActiveSection] = useState<SectionKey>('overview')
  const [routeSamples, setRouteSamples] = useState<FitnessRouteSample[]>([])
  const [routeDataError, setRouteDataError] = useState<string | null>(null)
  const [isRouteDataLoading, setIsRouteDataLoading] = useState(false)
  const [highlightedElapsedSeconds, setHighlightedElapsedSeconds] = useState<
    number | null
  >(null)

  const actorName = status.actor?.name || status.actor?.username || 'Athlete'
  const fitness = status.fitness
  const shouldLoadInteractiveMap = Boolean(mapboxAccessToken && fitness?.id)
  const activityLabel = getActivityLabel(fitness?.activityType)
  const statusTitle = status.text.trim() || `${activityLabel} workout`
  const statusDescription =
    fitness?.description ||
    'Strava-inspired activity view generated from your uploaded file.'
  const activityDate = formatUtcDate(
    status.createdAt,
    'p \u2022 EEEE, MMMM d, yyyy'
  )

  const paceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitness?.totalDistanceMeters,
    durationSeconds: fitness?.totalDurationSeconds,
    activityType: fitness?.activityType
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

  const mediaWithoutMap = status.attachments.filter(
    (_, index) => index !== mapAttachmentIndex
  )

  useEffect(() => {
    if (!shouldLoadInteractiveMap || !fitness?.id) {
      setRouteSamples([])
      setRouteDataError(null)
      setIsRouteDataLoading(false)
      return
    }

    let cancelled = false

    const loadRouteSamples = async () => {
      try {
        setIsRouteDataLoading(true)
        setRouteDataError(null)

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

        setRouteSamples(data.samples)
      } catch (_error) {
        if (cancelled) return
        setRouteSamples([])
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

  const speedKmh =
    paceOrSpeed?.speedKmh ??
    (distanceMeters > 0 && durationSeconds > 0
      ? distanceMeters / 1000 / (durationSeconds / 3600)
      : 0)

  const relativeEffort = Math.max(
    1,
    Math.min(
      300,
      Math.round(
        durationSeconds / 50 + elevationGainMeters / 12 + speedKmh * 1.4
      )
    )
  )

  const weightedAvgPower = Math.max(
    70,
    Math.round(speedKmh * 3 + relativeEffort * 0.55)
  )
  const totalWorkKj = Math.round(
    (weightedAvgPower * Math.max(0, durationSeconds)) / 1000
  )
  const trainingLoad = Math.max(5, Math.round(relativeEffort * 0.48))
  const intensity = Math.max(
    15,
    Math.min(100, Math.round((weightedAvgPower / 250) * 100))
  )

  const seededSeries = useMemo(() => {
    const next = createSeededGenerator(status.id)

    const lineSeries = (count: number, base: number, variance: number) => {
      return Array.from({ length: count }, (_, index) => {
        const drift = Math.sin(index / (count / 5)) * variance * 0.25
        const noise = (next() - 0.5) * variance
        return Math.max(1, base + drift + noise)
      })
    }

    const histogram = Array.from({ length: 20 }, (_, index) => {
      const center = 5
      const distanceFromCenter = Math.abs(index - center)
      const peak = Math.max(0, 1 - distanceFromCenter / 6)
      const noise = 0.2 + next() * 0.7
      return Math.max(0, peak * noise)
    })

    const heartRate = lineSeries(120, 120 + intensity * 0.35, 18)
    const power = lineSeries(120, weightedAvgPower, 42)
    const speed = lineSeries(120, Math.max(12, speedKmh), 4)
    const elevation = lineSeries(120, 12 + elevationGainMeters / 30, 7)

    return {
      heartRate,
      power,
      speed,
      elevation,
      histogram
    }
  }, [elevationGainMeters, intensity, speedKmh, status.id, weightedAvgPower])
  const elevationMin = Math.min(...seededSeries.elevation)
  const elevationMax = Math.max(...seededSeries.elevation)
  const powerMin = Math.min(...seededSeries.power)
  const powerMax = Math.max(...seededSeries.power)
  const elevationSampleCount = seededSeries.elevation.length
  const highlightedElevationIndex =
    typeof highlightedElapsedSeconds === 'number' &&
    durationSeconds > 0 &&
    elevationSampleCount > 0
      ? clampNumber(
          Math.round(
            (highlightedElapsedSeconds / durationSeconds) *
              (elevationSampleCount - 1)
          ),
          0,
          elevationSampleCount - 1
        )
      : null
  const highlightedElevationValue =
    typeof highlightedElevationIndex === 'number'
      ? seededSeries.elevation[highlightedElevationIndex]
      : null
  const highlightedElevationX =
    typeof highlightedElevationIndex === 'number'
      ? (highlightedElevationIndex / Math.max(1, elevationSampleCount - 1)) *
        760
      : null
  const highlightedElevationY =
    typeof highlightedElevationValue === 'number'
      ? getChartYPosition(
          highlightedElevationValue,
          GRAPH_VIEW_HEIGHT,
          elevationMin,
          elevationMax
        )
      : null
  const highlightedElapsedLabel =
    typeof highlightedElapsedSeconds === 'number'
      ? formatDuration(Math.round(highlightedElapsedSeconds))
      : null
  const histogramMinutes = useMemo(() => {
    const totalMinutes = Math.max(1, durationSeconds / 60)
    const totalWeight = Math.max(
      1,
      seededSeries.histogram.reduce((sum, value) => sum + value, 0)
    )

    return seededSeries.histogram.map(
      (value) => (value / totalWeight) * totalMinutes
    )
  }, [durationSeconds, seededSeries.histogram])

  const zoneDistribution = useMemo(() => {
    const total = Math.max(1, durationSeconds)
    const base = [0.28, 0.55, 0.11, 0.05, 0.01, 0.003, 0.002]

    return base.map((ratio, index) => {
      const seconds = Math.round(total * ratio)
      const percentage = Math.round(ratio * 100)
      return {
        zone: `Z${index + 1}`,
        seconds,
        percentage
      }
    })
  }, [durationSeconds])

  const heartRateZones = useMemo(() => {
    const base = [0.02, 0.26, 0.52, 0.17, 0.03]
    const total = Math.max(1, durationSeconds)

    return base.map((ratio, index) => {
      const seconds = Math.round(total * ratio)
      const percentage = Number((ratio * 100).toFixed(1))
      return {
        zone: `Z${index + 1}`,
        seconds,
        percentage
      }
    })
  }, [durationSeconds])

  const bestEfforts = useMemo(() => {
    const intervals = [5, 15, 30, 60, 120, 180, 300, 480, 600]
    return intervals.map((seconds, index) => {
      const dropOff = 1 - index * 0.08
      const effortPower = Math.max(
        90,
        Math.round(weightedAvgPower * (2.3 * dropOff))
      )
      const effortHeartRate = Math.round(
        122 + index * 3 + (intensity / 100) * 20
      )
      const effortElevation = Math.max(
        0,
        Math.round((elevationGainMeters / 180) * (index + 1))
      )

      return {
        label:
          seconds < 60 ? `${seconds} sec` : `${Math.round(seconds / 60)} min`,
        power: effortPower,
        powerKg: (effortPower / 56).toFixed(2),
        heartRate: effortHeartRate,
        elevation: effortElevation
      }
    })
  }, [elevationGainMeters, intensity, weightedAvgPower])

  const sectionContent = () => {
    if (activeSection === 'overview') {
      return (
        <div className="space-y-6 p-6">
          <div className="grid gap-6">
            <ActivityMapPanel
              mapAttachment={mapAttachment}
              routeSamples={routeSamples}
              mapboxAccessToken={mapboxAccessToken}
              routeDataError={routeDataError}
              isRouteDataLoading={isRouteDataLoading}
              onOpenMap={() => {
                if (mapAttachmentIndex >= 0) {
                  onShowAttachment(status.attachments, mapAttachmentIndex)
                }
              }}
            />

            <div className="rounded-sm border border-slate-300 bg-white p-5">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                Overview
              </h3>
              <p className="mt-2 text-sm text-slate-600">{statusDescription}</p>
              <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Flyby and other-athlete sections are intentionally hidden on
                this page.
              </div>
            </div>
          </div>

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
      )
    }

    if (activeSection === 'analysis') {
      const elevationChartHeight = GRAPH_VIEW_HEIGHT

      return (
        <div className="space-y-4 p-6">
          <div className="grid gap-4">
            <ActivityMapPanel
              mapAttachment={mapAttachment}
              routeSamples={routeSamples}
              highlightedElapsedSeconds={highlightedElapsedSeconds}
              mapboxAccessToken={mapboxAccessToken}
              routeDataError={routeDataError}
              isRouteDataLoading={isRouteDataLoading}
              compact
              onOpenMap={() => {
                if (mapAttachmentIndex >= 0) {
                  onShowAttachment(status.attachments, mapAttachmentIndex)
                }
              }}
            />
            <div className="rounded-lg border bg-white p-4">
              <div className="mb-2 flex items-end justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  Elevation profile
                </h3>
                <p className="text-xs text-slate-500">
                  Scale {elevationMin.toFixed(0)} m - {elevationMax.toFixed(0)}{' '}
                  m
                </p>
              </div>
              <div className="grid grid-cols-[auto_1fr] items-stretch gap-2">
                <div
                  className={cn(
                    'flex flex-col justify-between text-[11px] text-slate-500',
                    GRAPH_HEIGHT_CLASSNAME
                  )}
                >
                  <span>{elevationMax.toFixed(0)} m</span>
                  <span>{elevationMin.toFixed(0)} m</span>
                </div>
                <div>
                  <svg
                    viewBox={`0 0 760 ${elevationChartHeight}`}
                    preserveAspectRatio="none"
                    className={cn(
                      'w-full cursor-crosshair',
                      GRAPH_HEIGHT_CLASSNAME
                    )}
                    onMouseMove={(event) => {
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const ratio = clampNumber(
                        (event.clientX - bounds.left) /
                          Math.max(bounds.width, 1),
                        0,
                        1
                      )
                      setHighlightedElapsedSeconds(ratio * durationSeconds)
                    }}
                    onMouseLeave={() => {
                      setHighlightedElapsedSeconds(null)
                    }}
                  >
                    <path
                      d={buildChartPath(
                        seededSeries.elevation,
                        760,
                        elevationChartHeight,
                        elevationMin,
                        elevationMax
                      )}
                      className="stroke-slate-400 stroke-[2]"
                      fill="none"
                    />
                    {typeof highlightedElevationX === 'number' &&
                    typeof highlightedElevationY === 'number' ? (
                      <>
                        <line
                          x1={highlightedElevationX}
                          y1={0}
                          x2={highlightedElevationX}
                          y2={elevationChartHeight}
                          className="stroke-sky-500 stroke-[1.5] opacity-60"
                        />
                        <circle
                          cx={highlightedElevationX}
                          cy={highlightedElevationY}
                          r={4.5}
                          className="fill-sky-500 stroke-white stroke-[2]"
                        />
                      </>
                    ) : null}
                  </svg>
                  <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                    {buildXAxisLabels(
                      seededSeries.elevation.length,
                      durationSeconds
                    ).map((label, i) => (
                      <span key={i}>{label}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {highlightedElapsedLabel
                      ? `Selected time: ${highlightedElapsedLabel}`
                      : 'Hover the chart to follow that time point on the map.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <ChartPanel
            title="Speed"
            unit="km/h"
            values={seededSeries.speed}
            colorClassName="stroke-sky-500"
            minLabel={Math.min(...seededSeries.speed).toFixed(1)}
            maxLabel={Math.max(...seededSeries.speed).toFixed(1)}
            durationSeconds={durationSeconds}
          />
          <ChartPanel
            title="Power"
            unit="w"
            values={seededSeries.power}
            colorClassName="stroke-violet-500"
            minLabel={powerMin.toFixed(0)}
            maxLabel={powerMax.toFixed(0)}
            durationSeconds={durationSeconds}
          />
          <ChartPanel
            title="Heart rate"
            unit="bpm"
            values={seededSeries.heartRate}
            colorClassName="stroke-rose-500"
            minLabel={Math.min(...seededSeries.heartRate).toFixed(0)}
            maxLabel={Math.max(...seededSeries.heartRate).toFixed(0)}
            durationSeconds={durationSeconds}
          />
        </div>
      )
    }

    if (activeSection === 'heart-rate') {
      return (
        <div className="space-y-4 p-6">
          <h3 className="text-5xl font-semibold text-slate-900">
            Heart Rate Analysis
          </h3>
          <div className="overflow-hidden rounded-sm border border-slate-300">
            <table className="w-full bg-white text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Percent</th>
                  <th className="px-4 py-3">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {heartRateZones.map((zone) => (
                  <tr key={zone.zone} className="border-t">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {zone.zone}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDuration(zone.seconds)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {zone.percentage}%
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-8 w-full bg-slate-100">
                        <div
                          className="h-full bg-rose-300"
                          style={{ width: `${Math.max(zone.percentage, 1)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    if (activeSection === 'power-curve') {
      const powerCurveChartHeight = GRAPH_VIEW_HEIGHT

      return (
        <div className="space-y-4 p-6">
          <h3 className="text-5xl font-semibold text-slate-900">Power Curve</h3>
          <div className="rounded-sm border border-slate-300 bg-white p-4">
            <div className="mb-2 flex items-end justify-between">
              <p className="text-sm font-medium text-slate-700">
                Power (watts)
              </p>
              <p className="text-xs text-slate-500">
                Scale {powerMin.toFixed(0)} w - {powerMax.toFixed(0)} w
              </p>
            </div>
            <div className="grid grid-cols-[auto_1fr] items-stretch gap-2">
              <div
                className={cn(
                  'flex flex-col justify-between text-[11px] text-slate-500',
                  GRAPH_HEIGHT_CLASSNAME
                )}
              >
                <span>{powerMax.toFixed(0)} w</span>
                <span>{powerMin.toFixed(0)} w</span>
              </div>
              <div>
                <svg
                  viewBox={`0 0 760 ${powerCurveChartHeight}`}
                  preserveAspectRatio="none"
                  className={cn('w-full', GRAPH_HEIGHT_CLASSNAME)}
                >
                  <path
                    d={buildChartPath(
                      seededSeries.power,
                      760,
                      powerCurveChartHeight,
                      powerMin,
                      powerMax
                    )}
                    className="stroke-violet-600 stroke-[3]"
                    fill="none"
                  />
                </svg>
                <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                  {buildXAxisLabels(
                    seededSeries.power.length,
                    durationSeconds
                  ).map((label, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    if (activeSection === 'zone-distribution') {
      return (
        <div className="space-y-4 p-6">
          <h3 className="text-5xl font-semibold text-slate-900">
            Zone Distribution
          </h3>
          <div className="overflow-hidden rounded-sm border border-slate-300 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Percent</th>
                  <th className="px-4 py-3">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {zoneDistribution.map((zone) => (
                  <tr key={zone.zone} className="border-t">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {zone.zone}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDuration(zone.seconds)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {zone.percentage}%
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-8 w-full bg-slate-100">
                        <div
                          className="h-full bg-violet-300"
                          style={{ width: `${Math.max(zone.percentage, 1)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    if (activeSection === '25w-distribution') {
      const histogramViewHeight = GRAPH_VIEW_HEIGHT
      const histogramTopPadding = 16
      const histogramHeight = histogramViewHeight - histogramTopPadding
      const barCount = histogramMinutes.length
      const barGap = 2
      const totalGaps = (barCount - 1) * barGap
      const barWidth = (760 - totalGaps) / barCount
      const maxValue = Math.max(...histogramMinutes, 1)

      return (
        <div className="space-y-4 p-6">
          <h3 className="text-5xl font-semibold text-slate-900">
            25W Power Distribution
          </h3>
          <div className="rounded-sm border border-slate-300 bg-white p-4">
            <div className="mb-2 flex items-end justify-between">
              <p className="text-sm font-medium text-slate-700">
                Time spent per 25 W bucket
              </p>
              <p className="text-xs text-slate-500">
                Scale 0.0 min - {maxValue.toFixed(1)} min
              </p>
            </div>
            <div className="grid grid-cols-[auto_1fr] items-stretch gap-2">
              <div
                className={cn(
                  'flex flex-col justify-between text-[11px] text-slate-500',
                  GRAPH_HEIGHT_CLASSNAME
                )}
              >
                <span>{maxValue.toFixed(1)} min</span>
                <span>0.0 min</span>
              </div>
              <div>
                <svg
                  viewBox={`0 0 760 ${histogramViewHeight}`}
                  preserveAspectRatio="none"
                  className={cn('w-full', GRAPH_HEIGHT_CLASSNAME)}
                >
                  {histogramMinutes.map((value, index) => {
                    const x = index * (barWidth + barGap)
                    const barHeight = (value / maxValue) * histogramHeight
                    const y = histogramViewHeight - barHeight

                    return (
                      <rect
                        key={`bar-${index}`}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        fill={index > 7 ? '#9f4a8f' : '#c69cbf'}
                        opacity={0.9}
                      />
                    )
                  })}
                </svg>
                <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                  {histogramMinutes.map((_, index) => (
                    <span key={`label-${index}`} className="text-center">
                      {index * 25}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Time in each 25 W power bin (minutes)
            </p>
          </div>
        </div>
      )
    }

    if (activeSection === 'best-efforts') {
      return (
        <div className="space-y-4 p-6">
          <h3 className="text-5xl font-semibold text-slate-900">
            Best Efforts
          </h3>
          <div className="overflow-hidden rounded-sm border border-slate-300 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Power</th>
                  <th className="px-4 py-3">W/kg</th>
                  <th className="px-4 py-3">Heart Rate</th>
                  <th className="px-4 py-3">Elev</th>
                </tr>
              </thead>
              <tbody>
                {bestEfforts.map((effort) => (
                  <tr key={effort.label} className="border-t">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {effort.label}
                    </td>
                    <td className="px-4 py-3">{effort.power} w</td>
                    <td className="px-4 py-3">{effort.powerKg}</td>
                    <td className="px-4 py-3">{effort.heartRate} bpm</td>
                    <td className="px-4 py-3">{effort.elevation} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4 p-6">
        <h3 className="text-5xl font-semibold text-slate-900">Matched Rides</h3>
        <p className="text-sm text-slate-500">
          Only your activities are shown here. Flyby and other-athlete
          comparisons are excluded.
        </p>

        <div className="overflow-hidden rounded-sm border border-slate-300 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Speed</th>
                <th className="px-4 py-3">Moving Time</th>
                <th className="px-4 py-3">Relative Effort</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t bg-orange-50/50">
                <td className="px-4 py-3">
                  {formatUtcDate(status.createdAt, 'M/d/yy')}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {statusTitle}
                </td>
                <td className="px-4 py-3">{speedKmh.toFixed(1)} km/h</td>
                <td className="px-4 py-3">{formatDuration(durationSeconds)}</td>
                <td className="px-4 py-3">{relativeEffort}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <nav className="overflow-x-auto border-b border-border bg-[#f7f7f8]">
        <ul className="flex min-w-max">
          {NAV_ITEMS.filter((item) => !item.group).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'inline-block cursor-pointer whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors hover:text-foreground',
                  activeSection === item.id
                    ? 'border-b-2 border-primary text-primary'
                    : 'border-b-2 border-transparent text-muted-foreground'
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
          <li className="flex items-center px-2">
            <span className="h-4 w-px bg-border" />
          </li>
          {NAV_ITEMS.filter((item) => item.group === 'subscription').map(
            (item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'inline-block cursor-pointer whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors hover:text-foreground',
                    activeSection === item.id
                      ? 'border-b-2 border-primary text-primary'
                      : 'border-b-2 border-transparent text-muted-foreground'
                  )}
                >
                  {item.label}
                </button>
              </li>
            )
          )}
        </ul>
      </nav>

      <section className="bg-[#f4f4f6]">
        <div className="border-b border-slate-300 bg-[#f7f7f8] px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-orange-100 text-orange-600">
                <Bike className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-slate-900 md:text-4xl">
                  {actorName} - {activityLabel}
                </h1>
                <p className="mt-1 text-sm text-slate-500">{activityDate}</p>
                <h2 className="mt-2 min-w-0 break-words text-xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                  {statusTitle}
                </h2>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-y-1 border-b border-slate-300 bg-[#f0f1f3] px-2 py-2 md:grid-cols-4">
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
          <MetricCard label="Total Work" value={`${totalWorkKj} kJ`} />
          <MetricCard label="Weighted Avg" value={`${weightedAvgPower} w`} />
          <MetricCard label="Training Load" value={`${trainingLoad}`} />
          <MetricCard
            label="Relative Effort"
            value={`${relativeEffort}`}
            highlight
          />
        </div>

        <div className="border-b border-slate-300 bg-[#f4f4f6] px-6 py-3 text-sm text-slate-600">
          Intensity {intensity}%<span className="mx-3 text-slate-400">|</span>
          Sensor-level charts are estimated from the uploaded file summary.
        </div>

        {sectionContent()}
      </section>
    </div>
  )
}
