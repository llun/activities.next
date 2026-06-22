'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapSegment
} from '@/lib/client'
import { cn } from '@/lib/utils'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import { OPENFREEMAP_STYLE_URL, loadMaplibreModule } from '@/lib/utils/maplibre'

// The Mapbox GL / MapLibre GL surface — only the members this component drives.
// Both libraries share this subset, so one component can drive either provider.
type RouteGlMap = {
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

type RouteGlModule = {
  Map: new (options: Record<string, unknown>) => RouteGlMap
}

type MapFallbackReason = 'module-load-failed' | 'render-failed' | 'load-timeout'

interface MapFallbackError {
  message: string
  stack?: string
}

// Target vertex count handed to the GL line layer. A whole-world, all-time
// cache can aggregate hundreds of thousands of points and staging reproduced
// blank GL canvases past ~80k, so the geometry is uniformly downsampled toward
// this budget (see downsampleSegments). This keeps the map fully interactive
// (pan/zoom) instead of dropping to a static, non-interactive fallback.
const ROUTE_RENDER_POINT_BUDGET = 40_000
// Fall back to the "Map unavailable" message if the GL map never reaches its
// 'load' event (e.g. the style/tiles fail to fetch after the JS bundle loaded),
// instead of spinning the "Loading map…" overlay forever. Mirrors RegionMap.
const MAP_LOAD_TIMEOUT_MS = 20_000
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
const ROUTE_LINE_PAINT = {
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

const getMapFallbackError = (error: unknown): MapFallbackError => {
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

// Thin route geometry toward `maxPoints` vertices so the GL line layer stays
// performant on large caches (a whole-world cache can aggregate far more). The
// stride is derived from the global vertex total, so it bounds the dominant cost
// — long routes — proportionally; each segment still keeps its first and last
// vertex, so routes span their full extent. This is a best-effort target, not a
// hard ceiling: the per-segment endpoint floor (~2 vertices per segment) keeps a
// realistic many-route cache well under budget, but pathological inputs (tens of
// thousands of tiny segments) could still exceed it.
export const downsampleSegments = (
  segments: FitnessRouteHeatmapSegment[],
  maxPoints: number
): FitnessRouteHeatmapSegment[] => {
  const totalPoints = segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0
  )
  if (totalPoints <= maxPoints) {
    return segments
  }

  const stride = Math.ceil(totalPoints / maxPoints)
  return segments.map((segment) => {
    if (segment.points.length <= 2) {
      return segment
    }

    const points = segment.points.filter((_, index) => index % stride === 0)
    const lastPoint = segment.points[segment.points.length - 1]
    if (points[points.length - 1] !== lastPoint) {
      points.push(lastPoint)
    }
    return { ...segment, points }
  })
}

export interface RouteHeatmapMapProps {
  heatmap: FitnessRouteHeatmapData | null
  mapboxAccessToken?: string
}

interface RouteMapProvider {
  loadModule: () => Promise<RouteGlModule>
  mapOptions: Record<string, unknown>
  label: string
}

export const RouteHeatmapMap: FC<RouteHeatmapMapProps> = ({
  heatmap,
  mapboxAccessToken
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<RouteGlMap | null>(null)
  const routeGeoJsonRef = useRef(buildRouteGeoJson([]))
  const [mapFallbackReason, setMapFallbackReason] =
    useState<MapFallbackReason | null>(null)
  const [mapFallbackError, setMapFallbackError] =
    useState<MapFallbackError | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)

  const hasRoutes =
    heatmap?.status === 'completed' &&
    heatmap.segments.some((segment) => segment.points.length >= 2)
  const bounds = heatmap?.bounds

  // Mapbox when a public token is configured; otherwise the keyless MapLibre +
  // OpenFreeMap provider, so the heatmap always renders on a real, interactive
  // map without an API key (instead of a static, non-interactive image).
  const provider = useMemo<RouteMapProvider>(
    () =>
      mapboxAccessToken
        ? {
            loadModule: () => loadMapboxModule<RouteGlModule>(),
            mapOptions: {
              style: 'mapbox://styles/mapbox/outdoors-v12',
              accessToken: mapboxAccessToken
            },
            label: 'Mapbox'
          }
        : {
            loadModule: () => loadMaplibreModule<RouteGlModule>(),
            mapOptions: { style: OPENFREEMAP_STYLE_URL },
            label: 'OpenFreeMap'
          },
    [mapboxAccessToken]
  )

  const mapFallbackErrorMessage =
    process.env.NODE_ENV !== 'production'
      ? mapFallbackError?.message
      : undefined
  const shouldRenderMap = hasRoutes && Boolean(bounds) && !mapFallbackReason
  const routeGeoJson = useMemo(
    () =>
      buildRouteGeoJson(
        hasRoutes && heatmap
          ? downsampleSegments(heatmap.segments, ROUTE_RENDER_POINT_BUDGET)
          : []
      ),
    [hasRoutes, heatmap?.id, heatmap?.updatedAt]
  )

  useEffect(() => {
    routeGeoJsonRef.current = routeGeoJson
  }, [routeGeoJson])

  // Clear the fallback whenever the cache or provider changes so a recovered
  // map gets a fresh attempt.
  useEffect(() => {
    setMapFallbackReason(null)
    setMapFallbackError(null)
  }, [heatmap?.id, heatmap?.updatedAt, provider])

  useEffect(() => {
    if (!shouldRenderMap || !containerRef.current || !bounds) {
      return
    }

    let cancelled = false
    let loadWatchdog: ReturnType<typeof setTimeout> | undefined
    const mapBounds: [[number, number], [number, number]] = [
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat]
    ]
    setIsMapLoaded(false)

    provider
      .loadModule()
      .then((gl) => {
        if (cancelled || !containerRef.current) return

        const map = new gl.Map({
          container: containerRef.current,
          attributionControl: true,
          ...provider.mapOptions
        })
        mapRef.current = map

        // The module promise resolving only means the JS bundle loaded; if the
        // style/tiles never fetch, 'load' never fires and neither does .catch.
        // Without this the "Loading map…" overlay would spin forever.
        loadWatchdog = setTimeout(() => {
          if (!cancelled) {
            setMapFallbackError({
              message: 'Map timed out before the style finished loading'
            })
            setMapFallbackReason('load-timeout')
          }
        }, MAP_LOAD_TIMEOUT_MS)

        map.on('load', () => {
          if (cancelled) return
          if (loadWatchdog) clearTimeout(loadWatchdog)
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
              paint: ROUTE_LINE_PAINT
            })
            map.fitBounds(mapBounds, { padding: 56, duration: 0 })
            setIsMapLoaded(true)
          } catch (error) {
            if (!cancelled) {
              setMapFallbackError(getMapFallbackError(error))
              setMapFallbackReason('render-failed')
            }
          }
        })
      })
      .catch((error) => {
        if (!cancelled) {
          setMapFallbackError(getMapFallbackError(error))
          setMapFallbackReason('module-load-failed')
        }
      })

    return () => {
      cancelled = true
      if (loadWatchdog) clearTimeout(loadWatchdog)
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [
    bounds?.maxLat,
    bounds?.maxLng,
    bounds?.minLat,
    bounds?.minLng,
    heatmap?.id,
    provider,
    shouldRenderMap
  ])

  useEffect(() => {
    if (!shouldRenderMap || !isMapLoaded) return
    mapRef.current?.getSource('route-heatmap')?.setData(routeGeoJson)
  }, [isMapLoaded, routeGeoJson, shouldRenderMap])

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

  if (mapFallbackReason) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-col items-center justify-center gap-1 bg-muted/40 px-4 text-center text-sm text-muted-foreground',
          ROUTE_HEATMAP_MAP_HEIGHT_CLASS
        )}
        data-map-fallback-reason={mapFallbackReason}
        data-map-fallback-error={mapFallbackErrorMessage}
      >
        Map unavailable. Try regenerating this heatmap.
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-muted',
        ROUTE_HEATMAP_MAP_HEIGHT_CLASS
      )}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label="Fitness route heatmap"
        className="h-full w-full"
      />
      {!isMapLoaded && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-muted/60 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" /> Loading map…
        </div>
      )}
      {isMapLoaded && (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          {provider.label}
        </div>
      )}
    </div>
  )
}
