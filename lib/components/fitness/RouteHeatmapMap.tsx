'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapSegment
} from '@/lib/client'
import { simplifySegments } from '@/lib/services/fitness-files/simplifyRoute'
import { cn } from '@/lib/utils'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import {
  OPENFREEMAP_HEATMAP_STYLE_URL,
  loadMaplibreModule
} from '@/lib/utils/maplibre'

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
    options?: { padding?: number; duration?: number; maxZoom?: number }
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
// blank GL canvases past ~80k. The geometry is first simplified with
// Douglas–Peucker (shape-preserving, see ROUTE_RENDER_SIMPLIFY_TOLERANCE_METERS)
// and only then capped at this budget via the uniform downsampleSegments
// fallback, so a dense cache stays interactive without cutting corners off the
// road. The budget sits below the ~80k blank-canvas threshold with headroom.
const ROUTE_RENDER_POINT_BUDGET = 60_000
// Douglas–Peucker tolerance (meters) for the rendered geometry. Mirrors the
// server-side default so a freshly generated cache renders close to as-stored,
// while a legacy uniformly-decimated cache still gets its redundant collinear
// points trimmed at render time. Within a road lane, so the line keeps hugging
// the road at street zoom.
const ROUTE_RENDER_SIMPLIFY_TOLERANCE_METERS = 2
// Fall back to the "Map unavailable" message if the GL map never reaches its
// 'load' event (e.g. the style/tiles fail to fetch after the JS bundle loaded),
// instead of spinning the "Loading map…" overlay forever. Mirrors RegionMap.
const MAP_LOAD_TIMEOUT_MS = 20_000
const ROUTE_HEATMAP_MAP_HEIGHT_CLASS = 'h-[420px]'

// Absolute grid-cell size (degrees) used to cluster route points for the initial
// view. ~5° ≈ a few hundred km, so activities within a metro area land in the
// same or an 8-connected neighbouring cell while far-apart regions (e.g. Europe
// vs Singapore) fall into disjoint, non-adjacent cells. See computeFocusBounds.
const FOCUS_CLUSTER_CELL_DEG = 5
// When the cache spans disjoint regions we open focused on the densest cluster;
// cap the initial zoom so a very compact cluster still opens with surrounding
// context to pan from, rather than snapping to street level.
const FOCUS_MAX_ZOOM = 12

const ROUTE_LINE_STYLES = {
  visible: {
    color: '#ef4444',
    width: 2.8,
    opacity: 0.55
  },
  hidden: {
    color: '#2563eb',
    width: 2.2,
    opacity: 0.4
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
  'line-blur': 0.4
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

export interface RouteFocusBounds {
  bounds: FitnessRouteHeatmapBounds
  /** True when the view was tightened to a single dense cluster (disjoint data). */
  focused: boolean
}

const cellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

// A grid cell's point count plus the bounding box of the (finite) vertices in it,
// accumulated in a single pass so the focused extent needs no second scan.
interface FocusCell {
  count: number
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

// Pick the initial map view for a route cache. A whole-world / multi-region cache
// has bounds spanning every recorded region (e.g. Europe *and* Singapore), so
// fitting the full extent renders the routes as a tiny scatter on a flat world
// map. Instead, bucket the route vertices into an absolute lon/lat grid, flood
// fill the 8-connected cluster containing the densest cell, and fit to that
// cluster — so the map opens zoomed in on where most activity is while the user
// can still pan to the other regions. For a single contiguous region every
// vertex falls in one connected cluster, so the authoritative full bounds are
// returned unchanged (focused: false).
//
// Note: clusters straddling the antimeridian (±180° lon) land in non-adjacent
// cells and would not be merged; that is acceptable for this best-effort initial
// framing (mercator fitBounds has its own antimeridian limitations regardless).
export const computeFocusBounds = (
  segments: FitnessRouteHeatmapSegment[],
  bounds: FitnessRouteHeatmapBounds
): RouteFocusBounds => {
  // Single pass: bucket every finite vertex into an absolute grid cell, tracking
  // each cell's point count and bounding box. Non-finite vertices are skipped so
  // they never create a spurious cell.
  const cells = new Map<string, FocusCell>()
  for (const segment of segments) {
    for (const point of segment.points) {
      if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue
      const key = cellKey(
        Math.floor(point.lng / FOCUS_CLUSTER_CELL_DEG),
        Math.floor(point.lat / FOCUS_CLUSTER_CELL_DEG)
      )
      const cell = cells.get(key)
      if (!cell) {
        cells.set(key, {
          count: 1,
          minLat: point.lat,
          maxLat: point.lat,
          minLng: point.lng,
          maxLng: point.lng
        })
        continue
      }
      cell.count += 1
      if (point.lat < cell.minLat) cell.minLat = point.lat
      if (point.lat > cell.maxLat) cell.maxLat = point.lat
      if (point.lng < cell.minLng) cell.minLng = point.lng
      if (point.lng > cell.maxLng) cell.maxLng = point.lng
    }
  }

  // 0 or 1 occupied cell: nothing to disambiguate — show the full bounds.
  if (cells.size <= 1) {
    return { bounds, focused: false }
  }

  let seedKey = ''
  let seedCount = -1
  for (const [key, cell] of cells) {
    if (cell.count > seedCount) {
      seedCount = cell.count
      seedKey = key
    }
  }

  // 8-connected flood fill over occupied cells starting from the densest one.
  // Cells are marked visited as they are enqueued, so each is pushed exactly
  // once and only occupied neighbours enter the stack.
  const cluster = new Set<string>([seedKey])
  const stack = [seedKey]
  while (stack.length > 0) {
    const key = stack.pop() as string
    const [cellX, cellY] = key.split(':').map(Number)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue
        const neighborKey = cellKey(cellX + dx, cellY + dy)
        if (cells.has(neighborKey) && !cluster.has(neighborKey)) {
          cluster.add(neighborKey)
          stack.push(neighborKey)
        }
      }
    }
  }

  // Every occupied cell is in one connected cluster → the data is contiguous, so
  // the full bounds already frame it well.
  if (cluster.size === cells.size) {
    return { bounds, focused: false }
  }

  // Union the densest cluster's per-cell boxes into the focused extent. Each cell
  // came from at least one finite vertex, so the result is always finite.
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const key of cluster) {
    const cell = cells.get(key) as FocusCell
    if (cell.minLat < minLat) minLat = cell.minLat
    if (cell.maxLat > maxLat) maxLat = cell.maxLat
    if (cell.minLng < minLng) minLng = cell.minLng
    if (cell.maxLng > maxLng) maxLng = cell.maxLng
  }

  return { bounds: { minLat, maxLat, minLng, maxLng }, focused: true }
}

export interface RouteHeatmapMapProps {
  heatmap: FitnessRouteHeatmapData | null
  mapboxAccessToken?: string
  /**
   * Tailwind height class for the map surface (and its empty/fallback states).
   * Defaults to the in-app fixed height; the full-bleed embed passes a
   * viewport-height class (`h-dvh`).
   */
  heightClassName?: string
}

interface RouteMapProvider {
  loadModule: () => Promise<RouteGlModule>
  mapOptions: Record<string, unknown>
  label: string
}

export const RouteHeatmapMap: FC<RouteHeatmapMapProps> = ({
  heatmap,
  mapboxAccessToken,
  heightClassName = ROUTE_HEATMAP_MAP_HEIGHT_CLASS
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<RouteGlMap | null>(null)
  const routeGeoJsonRef = useRef(buildRouteGeoJson([]))
  const focusRef = useRef<RouteFocusBounds | null>(null)
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
              // Light 2D basemap so the coloured routes stand out, and an
              // explicit mercator projection so a wide cache opens as a flat,
              // pannable map instead of Mapbox GL v3's default zoomed-out globe.
              style: 'mapbox://styles/mapbox/light-v11',
              projection: 'mercator',
              accessToken: mapboxAccessToken
            },
            label: 'Mapbox'
          }
        : {
            loadModule: () => loadMaplibreModule<RouteGlModule>(),
            // MapLibre renders a flat mercator map by default; the light
            // "positron" style keeps the route overlay legible.
            mapOptions: { style: OPENFREEMAP_HEATMAP_STYLE_URL },
            label: 'OpenFreeMap'
          },
    [mapboxAccessToken]
  )

  const mapFallbackErrorMessage =
    process.env.NODE_ENV !== 'production'
      ? mapFallbackError?.message
      : undefined
  const shouldRenderMap = hasRoutes && Boolean(bounds) && !mapFallbackReason
  const downsampledSegments = useMemo(() => {
    if (!hasRoutes || !heatmap) return []
    // Shape-preserving simplification first (keeps the road shape), then the
    // uniform budget cap only as a ceiling for pathological caches.
    const simplified = simplifySegments(
      heatmap.segments,
      ROUTE_RENDER_SIMPLIFY_TOLERANCE_METERS
    )
    return downsampleSegments(simplified, ROUTE_RENDER_POINT_BUDGET)
  }, [hasRoutes, heatmap?.id, heatmap?.updatedAt])
  const routeGeoJson = useMemo(
    () => buildRouteGeoJson(downsampledSegments),
    [downsampledSegments]
  )
  // The initial framing: tighten a disjoint multi-region cache to its densest
  // cluster (computeFocusBounds), or keep the full bounds for a single region.
  const focus = useMemo<RouteFocusBounds | null>(
    () => (bounds ? computeFocusBounds(downsampledSegments, bounds) : null),
    [downsampledSegments, bounds]
  )

  useEffect(() => {
    routeGeoJsonRef.current = routeGeoJson
  }, [routeGeoJson])

  useEffect(() => {
    focusRef.current = focus
  }, [focus])

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
            // Frame the densest cluster (focused) or the full extent. The focus
            // is read from a ref so this asynchronous 'load' handler uses the
            // latest computed value rather than a stale closure; fitBounds runs
            // once per map mount (not on in-place, same-id cache updates).
            const framing = focusRef.current
            const frameBounds = framing?.bounds ?? bounds
            map.fitBounds(
              [
                [frameBounds.minLng, frameBounds.minLat],
                [frameBounds.maxLng, frameBounds.maxLat]
              ],
              {
                padding: 56,
                duration: 0,
                ...(framing?.focused ? { maxZoom: FOCUS_MAX_ZOOM } : {})
              }
            )
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
          heightClassName
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
          heightClassName
        )}
        data-map-fallback-reason={mapFallbackReason}
        data-map-fallback-error={mapFallbackErrorMessage}
      >
        Map unavailable. Try regenerating this heatmap.
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden bg-muted', heightClassName)}>
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
