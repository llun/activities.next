'use client'

import {
  AlertCircle,
  CalendarDays,
  Loader2,
  Map,
  RefreshCw,
  Route,
  Trash2
} from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessCalendarDay,
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapSegment,
  FitnessRouteHeatmapSummaryData,
  clearFitnessRouteHeatmaps,
  getDistinctFitnessActivityTypes,
  getFitnessCalendarData,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  triggerFitnessRouteHeatmap
} from '@/lib/client'
import {
  CalendarMetric,
  FitnessCalendarHeatmap
} from '@/lib/components/fitness/FitnessCalendarHeatmap'
import { FitnessHeatmapList } from '@/lib/components/fitness/FitnessHeatmapList'
import { RegionSelector } from '@/lib/components/fitness/RegionSelector'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { deserializeRegions, serializeRegions } from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import {
  getZoomLevelForBounds,
  projectWebMercator
} from '@/lib/utils/webMercator'

type PeriodType = 'all_time' | 'yearly' | 'monthly'

interface Props {
  actorId: string
  mapboxAccessToken?: string
}

type MapboxMap = {
  on: (event: string, callback: () => void) => void
  remove: () => void
  resize: () => void
  addSource: (id: string, source: unknown) => void
  addLayer: (layer: unknown) => void
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: { padding?: number; duration?: number }
  ) => void
}

type MapboxGL = {
  Map: new (options: Record<string, unknown>) => MapboxMap
}

type MapboxFallbackReason =
  | 'module-load-failed'
  | 'render-failed'
  | 'route-cache-too-large'

interface MapboxFallbackError {
  message: string
  stack?: string
}

const MAP_WIDTH = 960
const MAP_HEIGHT = 560
const MAP_PADDING = 52
const currentYear = new Date().getUTCFullYear()
const ROUTE_HEATMAP_POLLING_INTERVAL_MS = 5000
const STALLED_POLLING_LIMIT = 30
// Keep recent background jobs live while ignoring restored/stuck rows that are days old.
const STALE_IN_FLIGHT_HEATMAP_MS = 15 * 60_000
// Conservative cap: staging reproduced blank Mapbox canvases around 80k route points.
// Keep a 4x safety margin until this path has browser/device benchmarks.
const MAPBOX_MAX_ROUTE_POINTS = 20_000
const ROUTE_HEATMAP_MAP_HEIGHT_CLASS = 'h-[420px]'

const METRIC_LABELS: Record<CalendarMetric, string> = {
  count: 'Count',
  distance: 'Distance',
  duration: 'Duration'
}
const METRIC_OPTIONS = Object.entries(METRIC_LABELS) as [
  CalendarMetric,
  string
][]

const ROUTE_LINE_STYLES = {
  visible: {
    color: '#ef4444',
    width: 3.2,
    opacity: 0.2
  },
  hidden: {
    color: '#2563eb',
    width: 2.4,
    opacity: 0.14
  }
} as const
const MAPBOX_ROUTE_LINE_PAINT = {
  'line-color': [
    'case',
    ['boolean', ['get', 'isHiddenByPrivacy'], false],
    ROUTE_LINE_STYLES.hidden.color,
    ROUTE_LINE_STYLES.visible.color
  ],
  'line-width': [
    'case',
    ['boolean', ['get', 'isHiddenByPrivacy'], false],
    ROUTE_LINE_STYLES.hidden.width,
    ROUTE_LINE_STYLES.visible.width
  ],
  'line-opacity': [
    'case',
    ['boolean', ['get', 'isHiddenByPrivacy'], false],
    ROUTE_LINE_STYLES.hidden.opacity,
    ROUTE_LINE_STYLES.visible.opacity
  ],
  'line-blur': 0.8
} as const

const getRouteLineStyle = (isHiddenByPrivacy: boolean) =>
  isHiddenByPrivacy ? ROUTE_LINE_STYLES.hidden : ROUTE_LINE_STYLES.visible

const getMapboxFallbackError = (error: unknown): MapboxFallbackError => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    }
  }

  return {
    message: String(error)
  }
}

const formatActivityType = (type?: string): string =>
  type
    ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'All'

const isRouteHeatmapInFlight = (
  heatmap:
    | Pick<FitnessRouteHeatmapSummaryData, 'status'>
    | Pick<FitnessRouteHeatmapData, 'status'>
    | null
    | undefined
): boolean => heatmap?.status === 'generating' || heatmap?.status === 'pending'

const shouldPollRouteHeatmapSummary = (
  heatmap: Pick<FitnessRouteHeatmapSummaryData, 'status' | 'updatedAt'>,
  currentTime: number
): boolean =>
  isRouteHeatmapInFlight(heatmap) &&
  currentTime - heatmap.updatedAt <= STALE_IN_FLIGHT_HEATMAP_MS

const getCalendarDateRange = (
  periodType: PeriodType,
  periodKey: string
): { startDate: number; endDate: number } => {
  if (periodType === 'yearly') {
    const year = parseInt(periodKey, 10)
    return {
      startDate: Date.UTC(year, 0, 1),
      endDate: Date.UTC(year + 1, 0, 1)
    }
  }

  if (periodType === 'monthly') {
    const [yearStr, monthStr] = periodKey.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1
    return {
      startDate: Date.UTC(year, month, 1),
      endDate: Date.UTC(year, month + 1, 1)
    }
  }

  const now = new Date()
  const start = Date.UTC(
    now.getUTCFullYear() - 1,
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return { startDate: start, endDate: now.getTime() }
}

const generateYearOptions = (): number[] => {
  const years: number[] = []
  for (let y = currentYear; y >= currentYear - 10; y--) {
    years.push(y)
  }
  return years
}

const generateMonthOptions = (year: number): string[] => {
  const months: string[] = []
  const now = new Date()
  const maxMonth = year === now.getUTCFullYear() ? now.getUTCMonth() : 11
  for (let m = maxMonth; m >= 0; m--) {
    months.push(`${year}-${String(m + 1).padStart(2, '0')}`)
  }
  return months
}

const buildRouteGeoJson = (segments: FitnessRouteHeatmapSegment[]) => ({
  type: 'FeatureCollection' as const,
  features: segments
    .filter((segment) => segment.points.length >= 2)
    .map((segment) => ({
      type: 'Feature' as const,
      properties: {
        isHiddenByPrivacy: Boolean(segment.isHiddenByPrivacy)
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: segment.points.map((point) => [point.lng, point.lat])
      }
    }))
})

const buildSvgMap = (heatmap: FitnessRouteHeatmapData) => {
  if (!heatmap.bounds || heatmap.segments.length === 0) {
    return null
  }

  const zoom = Math.min(
    15,
    getZoomLevelForBounds({
      bounds: heatmap.bounds,
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      padding: MAP_PADDING
    })
  )
  const southWest = projectWebMercator(
    { lat: heatmap.bounds.minLat, lng: heatmap.bounds.minLng },
    zoom
  )
  const northEast = projectWebMercator(
    { lat: heatmap.bounds.maxLat, lng: heatmap.bounds.maxLng },
    zoom
  )
  const centerX = (southWest.x + northEast.x) / 2
  const centerY = (southWest.y + northEast.y) / 2
  const topLeftX = centerX - MAP_WIDTH / 2
  const topLeftY = centerY - MAP_HEIGHT / 2

  const lines = heatmap.segments
    .filter((segment) => segment.points.length >= 2)
    .map((segment, index) => {
      const isHiddenByPrivacy = Boolean(segment.isHiddenByPrivacy)
      return {
        key: `${heatmap.id}-${index}`,
        style: getRouteLineStyle(isHiddenByPrivacy),
        points: segment.points
          .map((point) => {
            const projected = projectWebMercator(point, zoom)
            return `${(projected.x - topLeftX).toFixed(1)},${(
              projected.y - topLeftY
            ).toFixed(1)}`
          })
          .join(' ')
      }
    })

  return { lines }
}

interface RouteHeatmapMapProps {
  heatmap: FitnessRouteHeatmapData | null
  mapboxAccessToken?: string
}

export const RouteHeatmapMap: FC<RouteHeatmapMapProps> = ({
  heatmap,
  mapboxAccessToken
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const routeGeoJsonRef = useRef(buildRouteGeoJson([]))
  const [runtimeMapboxFallbackReason, setRuntimeMapboxFallbackReason] =
    useState<Exclude<MapboxFallbackReason, 'route-cache-too-large'> | null>(
      null
    )
  const [mapboxFallbackError, setMapboxFallbackError] =
    useState<MapboxFallbackError | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)

  const hasRoutes =
    heatmap?.status === 'completed' &&
    heatmap.segments.some((segment) => segment.points.length >= 2)
  const bounds = heatmap?.bounds
  const isWithinMapboxBudget =
    heatmap !== null && heatmap.pointCount <= MAPBOX_MAX_ROUTE_POINTS
  const budgetMapboxFallbackReason: MapboxFallbackReason | null =
    mapboxAccessToken && hasRoutes && !isWithinMapboxBudget
      ? 'route-cache-too-large'
      : null
  const mapboxFallbackReason =
    runtimeMapboxFallbackReason ?? budgetMapboxFallbackReason
  const mapboxFallbackErrorMessage =
    process.env.NODE_ENV !== 'production'
      ? mapboxFallbackError?.message
      : undefined
  const shouldUseMapbox =
    Boolean(mapboxAccessToken) &&
    hasRoutes &&
    Boolean(bounds) &&
    isWithinMapboxBudget &&
    !runtimeMapboxFallbackReason
  const routeGeoJson = useMemo(
    () => buildRouteGeoJson(hasRoutes && heatmap ? heatmap.segments : []),
    [hasRoutes, heatmap?.id, heatmap?.updatedAt]
  )

  useEffect(() => {
    routeGeoJsonRef.current = routeGeoJson
  }, [routeGeoJson])

  useEffect(() => {
    setRuntimeMapboxFallbackReason(null)
    setMapboxFallbackError(null)
  }, [heatmap?.id, heatmap?.updatedAt, mapboxAccessToken])

  useEffect(() => {
    if (!shouldUseMapbox || !containerRef.current || !bounds) {
      return
    }

    let cancelled = false
    const mapBounds: [[number, number], [number, number]] = [
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat]
    ]
    setIsMapLoaded(false)

    loadMapboxModule<MapboxGL>()
      .then((mapboxgl) => {
        if (cancelled || !containerRef.current) return

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/outdoors-v12',
          accessToken: mapboxAccessToken,
          attributionControl: true,
          bounds: mapBounds,
          fitBoundsOptions: { padding: 56 }
        })
        mapRef.current = map

        map.on('load', () => {
          if (!map || cancelled) return
          try {
            map.resize()
            map.addSource('route-heatmap', {
              type: 'geojson',
              data: routeGeoJsonRef.current
            })
            map.addLayer({
              id: 'route-heatmap-lines',
              type: 'line',
              source: 'route-heatmap',
              layout: {
                'line-cap': 'round',
                'line-join': 'round'
              },
              paint: MAPBOX_ROUTE_LINE_PAINT
            })
            map.fitBounds(mapBounds, { padding: 56, duration: 0 })
            setIsMapLoaded(true)
          } catch (error) {
            if (!cancelled) {
              setMapboxFallbackError(getMapboxFallbackError(error))
              setRuntimeMapboxFallbackReason('render-failed')
            }
          }
        })
      })
      .catch((error) => {
        if (!cancelled) {
          setMapboxFallbackError(getMapboxFallbackError(error))
          setRuntimeMapboxFallbackReason('module-load-failed')
        }
      })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [
    bounds?.maxLat,
    bounds?.maxLng,
    bounds?.minLat,
    bounds?.minLng,
    heatmap?.id,
    mapboxAccessToken,
    shouldUseMapbox
  ])

  useEffect(() => {
    if (!shouldUseMapbox || !isMapLoaded) return
    mapRef.current?.getSource('route-heatmap')?.setData(routeGeoJson)
  }, [isMapLoaded, routeGeoJson, shouldUseMapbox])

  const svgMap = useMemo(
    () => (hasRoutes && heatmap ? buildSvgMap(heatmap) : null),
    [hasRoutes, heatmap?.id, heatmap?.updatedAt]
  )

  if (!hasRoutes || !heatmap) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted/40 text-sm text-muted-foreground',
          ROUTE_HEATMAP_MAP_HEIGHT_CLASS
        )}
      >
        No route data for this selection
      </div>
    )
  }

  if (shouldUseMapbox) {
    return (
      <div
        className={cn(
          'relative overflow-hidden bg-muted',
          ROUTE_HEATMAP_MAP_HEIGHT_CLASS
        )}
      >
        <div ref={containerRef} className="h-full w-full" />
        <div className="absolute left-3 top-3 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          Mapbox
        </div>
      </div>
    )
  }

  if (!svgMap) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted/40 text-sm text-muted-foreground',
          ROUTE_HEATMAP_MAP_HEIGHT_CLASS
        )}
      >
        No route data for this selection
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-slate-100 dark:bg-slate-950',
        ROUTE_HEATMAP_MAP_HEIGHT_CLASS
      )}
      data-mapbox-fallback-reason={mapboxFallbackReason ?? undefined}
      data-mapbox-fallback-error={mapboxFallbackErrorMessage}
    >
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="h-full w-full"
        role="img"
        aria-label="Fitness route heatmap"
        preserveAspectRatio="xMidYMid slice"
      >
        <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#f8fafc" />
        <g>
          {svgMap.lines.map((line) => (
            <polyline
              key={line.key}
              points={line.points}
              fill="none"
              stroke={line.style.color}
              strokeWidth={line.style.width}
              strokeOpacity={line.style.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      </svg>
      <div className="absolute left-3 top-3 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
        Routes
      </div>
      {mapboxFallbackReason ? (
        <p className="sr-only">Interactive map unavailable. Showing routes.</p>
      ) : null}
    </div>
  )
}

export const FitnessHeatmapView: FC<Props> = ({
  actorId,
  mapboxAccessToken
}) => {
  const [activityTypes, setActivityTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string>('')
  const [periodType, setPeriodType] = useState<PeriodType>('all_time')
  const [periodKey, setPeriodKey] = useState<string>('all')
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([])
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('count')

  const [heatmapData, setHeatmapData] =
    useState<FitnessRouteHeatmapData | null>(null)
  const [heatmaps, setHeatmaps] = useState<FitnessRouteHeatmapSummaryData[]>([])
  const [calendarDays, setCalendarDays] = useState<FitnessCalendarDay[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generationPending, setGenerationPending] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isClearCacheDialogOpen, setIsClearCacheDialogOpen] = useState(false)
  const [clearCacheError, setClearCacheError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now())
  const [pollingStalled, setPollingStalled] = useState(false)
  const isClearingCacheRef = useRef(false)
  const generationKeyRef = useRef<string | null>(null)
  const selectionKeyRef = useRef<string>('')
  const fetchRequestIdRef = useRef(0)
  const pollingProgressRef = useRef<{
    key: string
    fingerprint: string
    stalledCycles: number
  } | null>(null)

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    getDistinctFitnessActivityTypes({ actorId })
      .then(setActivityTypes)
      .catch(() => {})
  }, [actorId])

  const effectivePeriodKey = useMemo(() => {
    if (periodType === 'all_time') return 'all'
    if (periodType === 'yearly') return `${selectedYear}`
    return periodKey
  }, [periodType, selectedYear, periodKey])

  const serializedRegion = useMemo(
    () =>
      selectedRegionIds.length > 0 ? serializeRegions(selectedRegionIds) : null,
    [selectedRegionIds]
  )

  const selectedActivityType = selectedType || undefined
  const selectionKey = useMemo(
    () =>
      `${actorId}:${selectedActivityType ?? ''}:${periodType}:${effectivePeriodKey}:${serializedRegion ?? ''}`,
    [
      actorId,
      selectedActivityType,
      periodType,
      effectivePeriodKey,
      serializedRegion
    ]
  )

  useEffect(() => {
    selectionKeyRef.current = selectionKey
  }, [selectionKey])

  useEffect(() => {
    setHeatmapData(null)
    setGenerationPending(false)
    setPollingStalled(false)
    pollingProgressRef.current = null
  }, [selectionKey])

  const queueCurrentRouteHeatmap = useCallback(async (): Promise<boolean> => {
    const expectedSelectionKey = selectionKey
    if (selectionKeyRef.current !== expectedSelectionKey) return false

    const success = await triggerFitnessRouteHeatmap({
      actorId,
      activityType: selectedActivityType,
      periodType,
      periodKey: effectivePeriodKey,
      region: serializedRegion
    })
    if (!success) {
      throw new Error('Failed to enqueue route heatmap refresh.')
    }
    if (selectionKeyRef.current !== expectedSelectionKey) return false

    setGenerationPending(true)
    setPollingStalled(false)
    pollingProgressRef.current = null
    return true
  }, [
    actorId,
    selectedActivityType,
    periodType,
    effectivePeriodKey,
    serializedRegion,
    selectionKey
  ])

  const fetchData = useCallback(
    async (options?: { queueMissing?: boolean }) => {
      const requestId = fetchRequestIdRef.current + 1
      fetchRequestIdRef.current = requestId
      const queueMissing = options?.queueMissing ?? true
      const isCurrentRequest = () =>
        fetchRequestIdRef.current === requestId &&
        selectionKeyRef.current === selectionKey

      setIsLoading(true)
      setError(null)

      try {
        const { startDate, endDate } = getCalendarDateRange(
          periodType,
          effectivePeriodKey
        )
        const [heatmap, calendar, allHeatmaps] = await Promise.all([
          getFitnessRouteHeatmap({
            actorId,
            activityType: selectedActivityType,
            periodType,
            periodKey: effectivePeriodKey,
            region: serializedRegion
          }),
          getFitnessCalendarData({
            actorId,
            startDate,
            endDate,
            activityType: selectedActivityType
          }),
          getFitnessRouteHeatmaps({ actorId })
        ])

        if (!isCurrentRequest()) return

        setHeatmapData(heatmap)
        setCalendarDays(calendar)
        setHeatmaps(allHeatmaps)

        if (heatmap === null && queueMissing) {
          if (generationKeyRef.current !== selectionKey) {
            if (!isCurrentRequest()) return
            generationKeyRef.current = selectionKey
            try {
              const queued = await queueCurrentRouteHeatmap()
              if (!queued && generationKeyRef.current === selectionKey) {
                generationKeyRef.current = null
              }
            } catch (err) {
              if (!isCurrentRequest()) return
              generationKeyRef.current = null
              throw err
            }
          }
        }
      } catch (err) {
        if (!isCurrentRequest()) return
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load route heatmap data.'
        )
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false)
        }
      }
    },
    [
      actorId,
      selectedActivityType,
      periodType,
      effectivePeriodKey,
      serializedRegion,
      selectionKey,
      queueCurrentRouteHeatmap
    ]
  )

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const hasAnyListInFlight = useMemo(
    () =>
      heatmaps.some((heatmap) =>
        shouldPollRouteHeatmapSummary(heatmap, currentTime)
      ),
    [currentTime, heatmaps]
  )
  const isFocusedHeatmapInFlight =
    generationPending || isRouteHeatmapInFlight(heatmapData)
  const shouldPollFocusedHeatmap = isFocusedHeatmapInFlight && !pollingStalled

  useEffect(() => {
    const hasInFlight = shouldPollFocusedHeatmap || hasAnyListInFlight
    if (!hasInFlight) return

    const id = setInterval(() => {
      if (!shouldPollFocusedHeatmap) {
        getFitnessRouteHeatmaps({ actorId })
          .then((allHeatmaps) => {
            setHeatmaps(allHeatmaps)
            pollingProgressRef.current = null
            setPollingStalled(false)
          })
          .catch(() => {})
        return
      }

      Promise.all([
        getFitnessRouteHeatmap({
          actorId,
          activityType: selectedActivityType,
          periodType,
          periodKey: effectivePeriodKey,
          region: serializedRegion
        }),
        getFitnessRouteHeatmaps({ actorId })
      ])
        .then(([heatmap, allHeatmaps]) => {
          if (selectionKeyRef.current !== selectionKey) return

          setHeatmapData(heatmap)
          setHeatmaps(allHeatmaps)

          if (heatmap && !isRouteHeatmapInFlight(heatmap)) {
            setGenerationPending(false)
          }

          const nextFocusedInFlight =
            isRouteHeatmapInFlight(heatmap) ||
            (isFocusedHeatmapInFlight && heatmap === null)
          if (!nextFocusedInFlight) {
            pollingProgressRef.current = null
            setPollingStalled(false)
            return
          }

          const focusedFingerprint = heatmap
            ? `${heatmap.id}:${heatmap.status}:${heatmap.updatedAt}`
            : 'missing'
          const previous = pollingProgressRef.current

          if (
            !previous ||
            previous.key !== selectionKey ||
            previous.fingerprint !== focusedFingerprint
          ) {
            pollingProgressRef.current = {
              key: selectionKey,
              fingerprint: focusedFingerprint,
              stalledCycles: 0
            }
            return
          }

          const stalledCycles = previous.stalledCycles + 1
          pollingProgressRef.current = {
            ...previous,
            stalledCycles
          }

          if (stalledCycles >= STALLED_POLLING_LIMIT) {
            setGenerationPending(false)
            setPollingStalled(true)
          }
        })
        .catch(() => {})
    }, ROUTE_HEATMAP_POLLING_INTERVAL_MS)

    return () => clearInterval(id)
  }, [
    shouldPollFocusedHeatmap,
    hasAnyListInFlight,
    actorId,
    selectedActivityType,
    periodType,
    effectivePeriodKey,
    serializedRegion,
    selectionKey
  ])

  const yearOptions = useMemo(() => generateYearOptions(), [])
  const monthOptions = useMemo(
    () => generateMonthOptions(selectedYear),
    [selectedYear]
  )

  const handlePeriodTypeChange = (newType: PeriodType) => {
    setPeriodType(newType)
    if (newType === 'all_time') {
      setPeriodKey('all')
    } else if (newType === 'yearly') {
      setPeriodKey(`${selectedYear}`)
    } else {
      const month = String(new Date().getUTCMonth() + 1).padStart(2, '0')
      setPeriodKey(`${selectedYear}-${month}`)
    }
  }

  const handleYearChange = (year: number) => {
    setSelectedYear(year)
    if (periodType === 'yearly') {
      setPeriodKey(`${year}`)
      return
    }

    if (periodType === 'monthly') {
      const currentMonth = periodKey.split('-')[1] ?? '01'
      const newKey = `${year}-${currentMonth}`
      const options = generateMonthOptions(year)
      setPeriodKey(options.includes(newKey) ? newKey : options[0])
    }
  }

  const handleSelectHeatmap = useCallback(
    (heatmap: FitnessRouteHeatmapSummaryData) => {
      setSelectedType(heatmap.activityType ?? '')
      setPeriodType(heatmap.periodType as PeriodType)
      setPeriodKey(heatmap.periodKey)
      if (heatmap.periodType === 'yearly') {
        setSelectedYear(parseInt(heatmap.periodKey, 10))
      }
      if (heatmap.periodType === 'monthly') {
        setSelectedYear(parseInt(heatmap.periodKey.split('-')[0], 10))
      }
      setSelectedRegionIds(
        heatmap.region ? deserializeRegions(heatmap.region) : []
      )
    },
    []
  )

  const handleRetry = useCallback(
    async (
      heatmap: FitnessRouteHeatmapSummaryData,
      options: { retry?: boolean } = { retry: true }
    ) => {
      const success = await triggerFitnessRouteHeatmap({
        actorId,
        activityType: heatmap.activityType,
        periodType: heatmap.periodType as PeriodType,
        periodKey: heatmap.periodKey,
        region: heatmap.region || undefined,
        retry: options.retry
      })
      if (!success) {
        throw new Error('Failed to enqueue route heatmap refresh.')
      }
      setGenerationPending(true)
      setPollingStalled(false)
      pollingProgressRef.current = null
      getFitnessRouteHeatmaps({ actorId })
        .then(setHeatmaps)
        .catch(() => {})
    },
    [actorId]
  )

  const retryCurrent = async () => {
    setIsRetrying(true)
    setError(null)
    try {
      if (heatmapData) {
        await handleRetry(heatmapData, {
          retry:
            heatmapData.status === 'failed' ||
            heatmapData.status === 'generating'
        })
      } else {
        await queueCurrentRouteHeatmap()
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to enqueue route heatmap refresh.'
      )
    } finally {
      setIsRetrying(false)
    }
  }

  const setClearCacheDialogOpen = useCallback((open: boolean) => {
    if (isClearingCacheRef.current) return

    setClearCacheError(null)
    setIsClearCacheDialogOpen(open)
  }, [])

  const clearRouteCache = useCallback(async () => {
    if (isClearingCacheRef.current) return

    isClearingCacheRef.current = true
    setIsClearingCache(true)
    setClearCacheError(null)
    try {
      await clearFitnessRouteHeatmaps({ actorId })
      generationKeyRef.current = null
      pollingProgressRef.current = null
      setHeatmapData(null)
      setHeatmaps([])
      setGenerationPending(false)
      setPollingStalled(false)
      await fetchData({ queueMissing: false })
      setClearCacheError(null)
      setIsClearCacheDialogOpen(false)
    } catch (err) {
      setClearCacheError(
        err instanceof Error
          ? err.message
          : 'Failed to clear route heatmap cache.'
      )
    } finally {
      isClearingCacheRef.current = false
      setIsClearingCache(false)
    }
  }, [actorId, fetchData])

  const routeCount = heatmapData?.segments.length ?? 0
  const hasCompletedRoutes =
    heatmapData?.status === 'completed' && heatmapData.pointCount > 0
  const hasRouteCache =
    Boolean(heatmapData) || heatmaps.length > 0 || generationPending
  const canRefreshRouteCache =
    !isLoading && !generationPending && !isRouteHeatmapInFlight(heatmapData)
  const routeStatusOverlay =
    heatmapData?.status === 'failed'
      ? 'failed'
      : pollingStalled && !hasCompletedRoutes
        ? 'polling-stalled'
        : !isLoading && generationPending && !hasCompletedRoutes
          ? 'generation-pending'
          : null

  return (
    <div className="flex min-h-[720px] flex-col bg-background">
      <div className="flex flex-wrap items-start gap-3 border-b px-3 py-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Activity
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded border bg-background px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {activityTypes.map((type) => (
              <option key={type} value={type}>
                {formatActivityType(type)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Period
          <select
            value={periodType}
            onChange={(e) =>
              handlePeriodTypeChange(e.target.value as PeriodType)
            }
            className="rounded border bg-background px-2 py-1 text-sm"
          >
            <option value="all_time">All time</option>
            <option value="yearly">Yearly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        {periodType !== 'all_time' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Year
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              className="rounded border bg-background px-2 py-1 text-sm"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        )}

        {periodType === 'monthly' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Month
            <select
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-sm"
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="min-w-64 max-w-sm flex-1">
          <RegionSelector
            selectedIds={selectedRegionIds}
            onChange={setSelectedRegionIds}
          />
        </div>
      </div>

      {error && (
        <div className="border-b bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <section aria-label="Route heatmap map" className="min-w-0 border-b">
        <div className="border-b px-3 py-2">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Map className="size-4" />
              {formatActivityType(selectedActivityType)}
            </span>
            <span className="text-muted-foreground">
              {periodType === 'all_time' ? 'All time' : effectivePeriodKey}
            </span>
            <span className="text-muted-foreground">
              {selectedRegionIds.length > 0
                ? `${selectedRegionIds.length} regions`
                : 'World'}
            </span>
            {isLoading && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-muted-foreground"
              >
                <Loader2 className="size-3 animate-spin" />
                Loading…
              </span>
            )}
          </div>
        </div>

        <div className="relative overflow-hidden">
          <RouteHeatmapMap
            heatmap={heatmapData}
            mapboxAccessToken={mapboxAccessToken}
          />
          {routeStatusOverlay === 'generation-pending' && (
            <div
              className="absolute inset-x-3 bottom-3 rounded border bg-background/95 px-3 py-2 text-sm text-muted-foreground shadow-sm"
              aria-live="polite"
            >
              Route cache queued
            </div>
          )}
          {routeStatusOverlay === 'polling-stalled' && (
            <div
              className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded border bg-background/95 px-3 py-2 text-sm shadow-sm"
              aria-live="polite"
            >
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="size-4" />
                Route cache is taking longer than expected
              </span>
              <Button
                type="button"
                onClick={retryCurrent}
                disabled={isRetrying}
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
              >
                <RefreshCw
                  className={cn('size-3', isRetrying && 'animate-spin')}
                />
                Retry
              </Button>
            </div>
          )}
          {routeStatusOverlay === 'failed' && (
            <div
              className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded border bg-background/95 px-3 py-2 text-sm shadow-sm"
              aria-live="assertive"
            >
              <span className="inline-flex items-center gap-2 text-destructive">
                <AlertCircle className="size-4" />
                Route cache failed
              </span>
              <Button
                type="button"
                onClick={retryCurrent}
                disabled={isRetrying}
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
              >
                <RefreshCw
                  className={cn('size-3', isRetrying && 'animate-spin')}
                />
                Retry
              </Button>
            </div>
          )}
        </div>
      </section>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <section
            aria-labelledby="activity-calendar-heading"
            className="space-y-3 px-3 py-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="activity-calendar-heading"
                className="inline-flex items-center gap-2 text-base font-medium"
              >
                <CalendarDays className="size-4" />
                Activity Calendar
              </h2>
              <div className="flex gap-1 rounded border p-0.5">
                {METRIC_OPTIONS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={calendarMetric === key}
                    onClick={() => setCalendarMetric(key)}
                    className={cn(
                      'rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      calendarMetric === key
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <FitnessCalendarHeatmap
              days={calendarDays}
              metric={calendarMetric}
              periodType={periodType}
              periodKey={effectivePeriodKey}
              // This calendar sits directly on the page background, not a card.
              surfaceClassName="bg-background"
            />
          </section>
        </main>

        <aside className="border-t px-3 py-3 lg:border-l lg:border-t-0">
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Activities</div>
                <div className="mt-1 text-lg font-semibold">
                  {heatmapData?.activityCount ?? 0}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Segments</div>
                <div className="mt-1 text-lg font-semibold">{routeCount}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Points</div>
                <div className="mt-1 text-lg font-semibold">
                  {heatmapData?.pointCount ?? 0}
                </div>
              </div>
            </div>
            {heatmapData?.isPartial && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                Partial route cache capped at 1M files.
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 text-sm font-medium">
                  <Route className="size-4" />
                  Route Cache
                </h2>
                <div className="flex items-center gap-1.5">
                  {hasRouteCache && (
                    <button
                      type="button"
                      onClick={() => setClearCacheDialogOpen(true)}
                      disabled={isClearingCache || isRetrying}
                      aria-haspopup="dialog"
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2
                        className={cn(
                          'size-3',
                          isClearingCache && 'animate-pulse'
                        )}
                      />
                      Clear cache
                    </button>
                  )}
                  {canRefreshRouteCache && (
                    <button
                      type="button"
                      onClick={retryCurrent}
                      disabled={isRetrying || isClearingCache}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <RefreshCw
                        className={cn('size-3', isRetrying && 'animate-spin')}
                      />
                      {heatmapData ? 'Refresh' : 'Generate'}
                    </button>
                  )}
                </div>
              </div>
              <FitnessHeatmapList
                heatmaps={heatmaps}
                onSelect={handleSelectHeatmap}
                onRetry={handleRetry}
                currentTime={currentTime}
              />
            </div>
          </div>
        </aside>
      </div>
      <Dialog
        open={isClearCacheDialogOpen}
        onOpenChange={setClearCacheDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear route cache</DialogTitle>
            <DialogDescription>
              Clear all route heatmap cache for this account, including queued,
              generating, and failed route caches. This does not immediately
              start a new route cache job.
            </DialogDescription>
          </DialogHeader>
          {clearCacheError ? (
            <p
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {clearCacheError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearCacheDialogOpen(false)}
              disabled={isClearingCache}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={clearRouteCache}
              disabled={isClearingCache}
              aria-busy={isClearingCache}
            >
              <Trash2
                className={isClearingCache ? 'animate-pulse' : undefined}
              />
              {isClearingCache ? 'Clearing…' : 'Clear route caches'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
