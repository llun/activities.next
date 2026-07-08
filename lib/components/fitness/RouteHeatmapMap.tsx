'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import {
  RouteFocusBounds,
  buildRouteGeoJson,
  computeFocusBounds,
  downsampleSegments
} from '@/lib/components/fitness/mapGeometry'
import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'
import { cn } from '@/lib/utils'
import {
  type PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'

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
// blank GL canvases past ~80k. The geometry is fit to this budget by adaptively
// coarsening the Douglas–Peucker tolerance (shape-preserving, see
// simplifySegmentsToBudget) and only then capped via the uniform
// downsampleSegments fallback for pathological inputs, so a dense cache stays
// interactive without cutting corners off the road. The budget sits below the
// ~80k blank-canvas threshold with headroom.
const ROUTE_RENDER_POINT_BUDGET = 60_000
// Finest Douglas–Peucker tolerance (meters) for the rendered geometry. Mirrors
// the server-side floor so a freshly generated cache renders close to as-stored;
// a sparse region keeps this full detail, while a dense one is coarsened up from
// here to fit the budget. Near the GPS-noise floor, so the line hugs the road at
// street zoom without amplifying jitter.
const ROUTE_RENDER_SIMPLIFY_TOLERANCE_METERS = 1
// Fall back to the "Map unavailable" message if the GL map never reaches its
// 'load' event (e.g. the style/tiles fail to fetch after the JS bundle loaded),
// instead of spinning the "Loading map…" overlay forever. Mirrors RegionMap.
const MAP_LOAD_TIMEOUT_MS = 20_000
const ROUTE_HEATMAP_MAP_HEIGHT_CLASS = 'h-[420px]'

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

export interface RouteHeatmapMapProps {
  heatmap: FitnessRouteHeatmapData | null
  /** Which map backend renders this heatmap (Mapbox, keyless OSM, or Apple). */
  mapProvider: PublicMapProvider
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

// TODO(apple-maps): Apple renders through MapKit JS, not a GL engine. Until the
// dedicated MapKit renderer lands (the MapKit-renderers task), fall back to the
// keyless OpenFreeMap GL map so an Apple-configured instance keeps rendering
// heatmaps instead of crashing. That task replaces this branch.
const toGlProvider = (
  provider: PublicMapProvider
): Exclude<PublicMapProvider, { type: 'apple' }> =>
  provider.type === 'apple' ? { type: 'osm' } : provider

export const RouteHeatmapMap: FC<RouteHeatmapMapProps> = ({
  heatmap,
  mapProvider,
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
  // map without an API key (instead of a static, non-interactive image). Keyed
  // on the descriptor's fields (not its object identity) so an inline prop
  // literal doesn't tear the map down on every parent render.
  const providerType = mapProvider.type
  const providerAccessToken =
    mapProvider.type === 'mapbox' ? mapProvider.accessToken : undefined
  const provider = useMemo<RouteMapProvider>(() => {
    const options = buildGlProviderOptions(toGlProvider(mapProvider), 'light')
    return {
      loadModule: () => options.loadModule() as Promise<RouteGlModule>,
      mapOptions: options.mapOptions,
      label: options.label
    }
  }, [providerType, providerAccessToken])

  const mapFallbackErrorMessage =
    process.env.NODE_ENV !== 'production'
      ? mapFallbackError?.message
      : undefined
  const shouldRenderMap = hasRoutes && Boolean(bounds) && !mapFallbackReason
  const downsampledSegments = useMemo(() => {
    if (!hasRoutes || !heatmap) return []
    // Fit the budget by adaptively coarsening the tolerance (shape-preserving),
    // then the uniform cap only as a ceiling for pathological caches.
    const simplified = simplifySegmentsToBudget(
      heatmap.segments,
      ROUTE_RENDER_POINT_BUDGET,
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
    let resizeObserver: ResizeObserver | undefined
    setIsMapLoaded(false)

    provider
      .loadModule()
      .then((gl) => {
        // Capture the element once: a ref's `.current` is not narrowed across
        // the calls below, so a local keeps both the map and the observer
        // strictly non-null.
        const container = containerRef.current
        if (cancelled || !container) return

        const map = new gl.Map({
          container,
          attributionControl: true,
          ...provider.mapOptions
        })
        mapRef.current = map

        // Mapbox/MapLibre GL size their canvas from the container at
        // construction and only recompute it when map.resize() is called; the
        // libraries' built-in trackResize listens for *window* resizes only.
        // When the container itself changes width while the window holds steady
        // — e.g. the Share & embed preview swapping size as the owner picks
        // Small/Medium/Large, or a collapsing sidebar — the canvas would keep
        // its old width and leave blank space beside the map. Observe the
        // container and resize on every box change so the map always fills it.
        // (ResizeObserver throttles to animation frames, so resizing directly
        // in the callback is already frame-batched; it never grows the observed
        // box, so there is no resize loop.)
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            mapRef.current?.resize()
          })
          resizeObserver.observe(container)
        }

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
      resizeObserver?.disconnect()
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
