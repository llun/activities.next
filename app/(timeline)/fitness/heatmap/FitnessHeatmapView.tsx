'use client'

import {
  AlertCircle,
  Flame,
  Loader2,
  Map,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapSegment,
  FitnessRouteHeatmapSummaryData,
  clearFitnessRouteHeatmaps,
  deleteFitnessRouteHeatmap,
  getDistinctFitnessActivityTypes,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  triggerFitnessRouteHeatmap
} from '@/lib/client'
import { FitnessHeatmapList } from '@/lib/components/fitness/FitnessHeatmapList'
import {
  HeatmapRegionPicker,
  PickerRegion,
  toHeatmapRegion,
  withRegionIds
} from '@/lib/components/fitness/HeatmapRegionPicker'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Select } from '@/lib/components/ui/select'
import {
  describeRegions,
  deserializeRegions,
  serializeRegions
} from '@/lib/fitness/regions'
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

const formatPeriodLabel = (periodType: string, periodKey: string): string =>
  periodType === 'all_time' ? 'All time' : periodKey

const progressNumberFormatter = new Intl.NumberFormat()

/**
 * Builds a human-readable progress fragment for the focused, in-flight heatmap.
 * Uses `cursorOffset` (files scanned) over `totalCount` (computed denominator);
 * returns just a scanned count while the total is still unknown (0).
 */
const formatFocusedProgress = (
  heatmap: Pick<FitnessRouteHeatmapData, 'totalCount' | 'cursorOffset'> | null
): { percent: number | null; label: string } | null => {
  if (!heatmap) return null

  const total = heatmap.totalCount
  const scanned = heatmap.cursorOffset

  if (total > 0) {
    const cappedScanned = Math.min(scanned, total)
    const percent = Math.max(
      0,
      Math.min(100, Math.round((cappedScanned / total) * 100))
    )
    return {
      percent,
      label: `${progressNumberFormatter.format(cappedScanned)} / ${progressNumberFormatter.format(total)} files (${percent}%)`
    }
  }

  if (scanned > 0) {
    return {
      percent: null,
      label: `${progressNumberFormatter.format(scanned)} files scanned`
    }
  }

  return { percent: null, label: 'Starting…' }
}

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
  // Static id for the default so the initial SSR render and client hydration
  // produce identical state (a dynamically generated id would differ).
  const [regions, setRegions] = useState<PickerRegion[]>(() => [
    { type: 'world', id: 'world' }
  ])

  const [heatmapData, setHeatmapData] =
    useState<FitnessRouteHeatmapData | null>(null)
  const [heatmaps, setHeatmaps] = useState<FitnessRouteHeatmapSummaryData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generationPending, setGenerationPending] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isClearCacheDialogOpen, setIsClearCacheDialogOpen] = useState(false)
  const [clearCacheError, setClearCacheError] = useState<string | null>(null)
  const [heatmapPendingRemoval, setHeatmapPendingRemoval] =
    useState<FitnessRouteHeatmapSummaryData | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
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

  const serializedRegion = useMemo(() => {
    const serialized = serializeRegions(regions.map(toHeatmapRegion))
    return serialized === '' ? null : serialized
  }, [regions])
  const hasRegions = regions.length > 0

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
        const [heatmap, allHeatmaps] = await Promise.all([
          getFitnessRouteHeatmap({
            actorId,
            activityType: selectedActivityType,
            periodType,
            periodKey: effectivePeriodKey,
            region: serializedRegion
          }),
          getFitnessRouteHeatmaps({ actorId })
        ])

        if (!isCurrentRequest()) return

        setHeatmapData(heatmap)
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
      setRegions(withRegionIds(deserializeRegions(heatmap.region ?? '')))
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

  const handleRemoveRequest = useCallback(
    (heatmap: FitnessRouteHeatmapSummaryData) => {
      setRemoveError(null)
      setHeatmapPendingRemoval(heatmap)
    },
    []
  )

  const closeRemoveDialog = useCallback(() => {
    if (isRemoving) return
    setRemoveError(null)
    setHeatmapPendingRemoval(null)
  }, [isRemoving])

  const confirmRemove = useCallback(async () => {
    if (!heatmapPendingRemoval) return

    const target = heatmapPendingRemoval
    setIsRemoving(true)
    setRemoveError(null)
    try {
      const removed = await deleteFitnessRouteHeatmap({
        actorId,
        activityType: target.activityType,
        periodType: target.periodType,
        periodKey: target.periodKey,
        region: target.region || undefined
      })
      if (!removed) {
        throw new Error('Heatmap was already removed.')
      }

      setHeatmaps((current) => current.filter((h) => h.id !== target.id))
      if (heatmapData?.id === target.id) {
        setHeatmapData(null)
        setGenerationPending(false)
        setPollingStalled(false)
        pollingProgressRef.current = null
        // Don't auto-requeue the heatmap the user just removed.
        generationKeyRef.current = selectionKey
      }
      setHeatmapPendingRemoval(null)
      getFitnessRouteHeatmaps({ actorId })
        .then(setHeatmaps)
        .catch(() => {})
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : 'Failed to remove route heatmap.'
      )
    } finally {
      setIsRemoving(false)
    }
  }, [actorId, heatmapData?.id, heatmapPendingRemoval, selectionKey])

  const routeCount = heatmapData?.segments.length ?? 0
  const hasCompletedRoutes =
    heatmapData?.status === 'completed' && heatmapData.pointCount > 0
  const hasRouteCache =
    Boolean(heatmapData) || heatmaps.length > 0 || generationPending
  const isFocusedGenerating = heatmapData?.status === 'generating'
  const focusedProgress = isFocusedGenerating
    ? formatFocusedProgress(heatmapData)
    : null
  const routeStatusOverlay =
    heatmapData?.status === 'failed'
      ? 'failed'
      : pollingStalled && !hasCompletedRoutes
        ? 'polling-stalled'
        : !isLoading &&
            (isFocusedGenerating || (generationPending && !hasCompletedRoutes))
          ? 'generation-pending'
          : null

  const regionLabel = hasRegions
    ? describeRegions(serializedRegion ?? '')
    : 'No region selected'
  const periodLabel =
    periodType === 'all_time' ? 'All time' : effectivePeriodKey
  const isGenerateBusy =
    isRetrying || generationPending || isRouteHeatmapInFlight(heatmapData)
  const canGenerate =
    !isLoading && !isGenerateBusy && !isClearingCache && hasRegions

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Generate panel */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Flame className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Generate a heatmap</div>
            <div className="text-[11px] text-muted-foreground">
              Aggregate your routes into a density map.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">
              Activity
            </span>
            <Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="">All activities</option>
              {activityTypes.map((type) => (
                <option key={type} value={type}>
                  {formatActivityType(type)}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">
              Period
            </span>
            <Select
              value={periodType}
              onChange={(e) =>
                handlePeriodTypeChange(e.target.value as PeriodType)
              }
            >
              <option value="all_time">All time</option>
              <option value="yearly">Yearly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </label>

          {periodType !== 'all_time' && (
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                Year
              </span>
              <Select
                value={selectedYear}
                onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {periodType === 'monthly' && (
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                Month
              </span>
              <Select
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">
            Regions
          </span>
          <HeatmapRegionPicker
            value={regions}
            onChange={setRegions}
            mapboxAccessToken={mapboxAccessToken}
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={retryCurrent} disabled={!canGenerate}>
            <Flame
              className={cn('size-4', isGenerateBusy && 'animate-pulse')}
            />
            Generate heatmap
          </Button>
        </div>
      </section>

      {/* Preview of the focused heatmap */}
      <section
        aria-label="Route heatmap map"
        className="overflow-hidden rounded-xl border bg-card shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="text-base font-semibold">
              {formatActivityType(selectedActivityType)} · {periodLabel}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Map className="size-3.5" />
                {regionLabel}
              </span>
              <span>·</span>
              <span>{heatmapData?.activityCount ?? 0} activities</span>
              <span>·</span>
              <span>{routeCount} segments</span>
              {isLoading && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5"
                >
                  <Loader2 className="size-3 animate-spin" />
                  Loading…
                </span>
              )}
            </div>
          </div>
        </div>

        {heatmapData?.isPartial && (
          <div className="mx-4 mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Partial route cache capped at 1M files.
          </div>
        )}

        <div className="relative overflow-hidden">
          <RouteHeatmapMap
            heatmap={heatmapData}
            mapboxAccessToken={mapboxAccessToken}
          />
          {routeStatusOverlay === 'generation-pending' && (
            <div
              className="absolute inset-x-3 bottom-3 flex flex-col gap-1.5 rounded border bg-background/95 px-3 py-2 text-sm text-muted-foreground shadow-sm"
              aria-live="polite"
            >
              {isFocusedGenerating && focusedProgress ? (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" />
                    Generating heatmap · {focusedProgress.label}
                  </span>
                  <span
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Heatmap generation progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    {...(focusedProgress.percent === null
                      ? {}
                      : { 'aria-valuenow': focusedProgress.percent })}
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full bg-blue-500 transition-[width] duration-500 dark:bg-blue-400',
                        focusedProgress.percent === null &&
                          'w-1/3 animate-pulse'
                      )}
                      style={
                        focusedProgress.percent === null
                          ? undefined
                          : { width: `${focusedProgress.percent}%` }
                      }
                    />
                  </span>
                </>
              ) : (
                'Route cache queued'
              )}
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

      {/* Job list */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Heatmaps</h2>
          {hasRouteCache && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setClearCacheDialogOpen(true)}
              disabled={isClearingCache || isRetrying}
              aria-haspopup="dialog"
            >
              <Trash2
                className={cn('size-3.5', isClearingCache && 'animate-pulse')}
              />
              Clear cache
            </Button>
          )}
        </div>
        <FitnessHeatmapList
          heatmaps={heatmaps}
          onSelect={handleSelectHeatmap}
          onRetry={handleRetry}
          onRemove={handleRemoveRequest}
          currentTime={currentTime}
        />
      </section>

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

      <Dialog
        open={heatmapPendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) closeRemoveDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove heatmap</DialogTitle>
            <DialogDescription>
              {heatmapPendingRemoval
                ? `Remove the ${formatActivityType(
                    heatmapPendingRemoval.activityType
                  )} · ${formatPeriodLabel(
                    heatmapPendingRemoval.periodType,
                    heatmapPendingRemoval.periodKey
                  )} heatmap from your list? You can regenerate it later.`
                : 'Remove this heatmap from your list? You can regenerate it later.'}
            </DialogDescription>
          </DialogHeader>
          {removeError ? (
            <p
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {removeError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeRemoveDialog}
              disabled={isRemoving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmRemove}
              disabled={isRemoving}
              aria-busy={isRemoving}
            >
              <Trash2 className={isRemoving ? 'animate-pulse' : undefined} />
              {isRemoving ? 'Removing…' : 'Remove heatmap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
