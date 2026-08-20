'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { RouteHeatmapMapKit } from '@/lib/components/fitness/RouteHeatmapMapKit'
import { buildTileGeoJson } from '@/lib/components/fitness/heatmapTileGeometry'
import {
  RouteFocusBounds,
  buildRouteGeoJson,
  computeFocusBounds,
  downsampleSegments
} from '@/lib/components/fitness/mapGeometry'
import {
  HeatmapTileFetcher,
  HeatmapViewport,
  useHeatmapTiles
} from '@/lib/components/fitness/useHeatmapTiles'
import {
  HEAT_COUNT_SATURATION,
  HEAT_HIDDEN_BASE_OPACITY,
  HEAT_VISIBLE_BASE_OPACITY,
  heatOpacityForCount
} from '@/lib/services/fitness-files/heatmapTiles/constants'
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
  // Only needed by the tiled path, which must stop listening when the heatmap
  // it was fetching for goes away — the map itself outlives that.
  off?: (event: string, callback: () => void) => void
  getZoom?: () => number
  getBounds?: () => {
    getWest: () => number
    getSouth: () => number
    getEast: () => number
    getNorth: () => number
  }
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
/**
 * The tiled layer's ramp, in visit counts.
 *
 * Colour and width are interpolated over the count so a street ridden fifty
 * times reads differently from one ridden once — which is the whole reason the
 * pyramid stores a count per stretch of road rather than one polyline per
 * activity. Opacity is NOT hand-tuned: it is generated from
 * `heatOpacityForCount`, the same function the server documents the ramp with,
 * so the two cannot drift and a test can pin the formula rather than a copied
 * table of numbers.
 */
const TILE_COUNT_COLOR_STOPS = [1, '#ef4444', 4, '#f97316', 12, '#facc15']
const TILE_COUNT_WIDTH_STOPS = [1, 2.8, 4, 3.4, 16, 4.2]

export const tileOpacityStops = (base: number): number[] =>
  Array.from(
    { length: HEAT_COUNT_SATURATION },
    (_unused, index) => index + 1
  ).flatMap((count) => [count, heatOpacityForCount(count, base)])

const countRamp = (stops: Array<number | string>) => [
  'interpolate',
  ['linear'],
  ['get', 'count'],
  ...stops
]

const TILE_LINE_PAINT = {
  'line-color': [
    'case',
    ['boolean', ['get', 'isHiddenByPrivacy'], false],
    ROUTE_LINE_STYLES.hidden.color,
    countRamp(TILE_COUNT_COLOR_STOPS)
  ],
  'line-width': [
    'case',
    ['boolean', ['get', 'isHiddenByPrivacy'], false],
    ROUTE_LINE_STYLES.hidden.width,
    countRamp(TILE_COUNT_WIDTH_STOPS)
  ],
  'line-opacity': [
    'case',
    ['boolean', ['get', 'isHiddenByPrivacy'], false],
    countRamp(tileOpacityStops(HEAT_HIDDEN_BASE_OPACITY)),
    countRamp(tileOpacityStops(HEAT_VISIBLE_BASE_OPACITY))
  ],
  'line-blur': 0.4
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

const EMPTY_GEOJSON = buildRouteGeoJson([])

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
   * Binds a tile request to whatever credential this surface holds — the
   * owner's actor id and region, or a share token. Omitted (or paired with a
   * heatmap carrying no `tileSource`) leaves the map on its untiled geometry,
   * which is what every surface drew before the pyramid existed.
   */
  fetchTiles?: HeatmapTileFetcher
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

/**
 * Renders the heatmap with the configured provider's engine. Apple renders
 * through MapKit JS, not a GL engine, so it delegates to the MapKit sibling;
 * Mapbox and OpenFreeMap share the GL surface below.
 */
export const RouteHeatmapMap: FC<RouteHeatmapMapProps> = ({
  heatmap,
  mapProvider,
  fetchTiles,
  heightClassName = ROUTE_HEATMAP_MAP_HEIGHT_CLASS
}) => {
  if (mapProvider.type === 'apple') {
    return (
      <RouteHeatmapMapKit
        heatmap={heatmap}
        fetchTiles={fetchTiles}
        heightClassName={heightClassName}
      />
    )
  }

  return (
    <RouteHeatmapGlMap
      heatmap={heatmap}
      mapProvider={mapProvider}
      fetchTiles={fetchTiles}
      heightClassName={heightClassName}
    />
  )
}

interface RouteHeatmapGlMapProps {
  heatmap: FitnessRouteHeatmapData | null
  mapProvider: Exclude<PublicMapProvider, { type: 'apple' }>
  fetchTiles?: HeatmapTileFetcher
  heightClassName: string
}

const RouteHeatmapGlMap: FC<RouteHeatmapGlMapProps> = ({
  heatmap,
  mapProvider,
  fetchTiles,
  heightClassName
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<RouteGlMap | null>(null)
  const routeGeoJsonRef = useRef(buildRouteGeoJson([]))
  const tileGeoJsonRef = useRef(buildTileGeoJson([]))
  // Seeded with a no-op and assigned below: the map's event handlers are
  // registered inside an async 'load' callback that outlives this render, so
  // they must read the CURRENT hook callback rather than close over the first.
  const onViewChangeRef = useRef<(viewport: HeatmapViewport) => void>(() => {})
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
    const options = buildGlProviderOptions(mapProvider, 'light')
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

  const tiles = useHeatmapTiles({
    tileSource: heatmap?.tileSource,
    fetchTiles
  })
  // Tiles REPLACE the untiled geometry once a batch has resolved, rather than
  // drawing over it: the two describe the same roads at different fidelities,
  // and stacking them doubles every line's opacity.
  const hasTiles = tiles.runs.length > 0
  const tileGeoJson = useMemo(() => buildTileGeoJson(tiles.runs), [tiles.runs])
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
    tileGeoJsonRef.current = tileGeoJson
  }, [tileGeoJson])

  useEffect(() => {
    onViewChangeRef.current = tiles.onViewChange
  }, [tiles.onViewChange])

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
    let reportView: (() => void) | undefined
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
            map.addSource('route-heatmap-tiles', {
              type: 'geojson',
              data: tileGeoJsonRef.current
            })
            map.addLayer({
              id: 'route-heatmap-tile-lines',
              type: 'line',
              source: 'route-heatmap-tiles',
              layout: {
                // Butt caps, unlike the untiled layer's round ones: tiled
                // geometry is a mesh of short runs that meet end to end, and a
                // round cap on each would stack a blob of extra opacity at
                // every junction.
                'line-cap': 'butt',
                'line-join': 'round'
              },
              paint: TILE_LINE_PAINT
            })

            // Report the settled view so the hook can fetch for it. `moveend`
            // covers panning and `zoomend` the ladder changes; both fire after
            // the gesture, and the hook debounces whatever slips through.
            reportView = () => {
              const zoom = map.getZoom?.()
              const viewBounds = map.getBounds?.()
              if (typeof zoom !== 'number' || !viewBounds) return
              onViewChangeRef.current({
                zoom,
                bounds: {
                  minLat: viewBounds.getSouth(),
                  maxLat: viewBounds.getNorth(),
                  minLng: viewBounds.getWest(),
                  maxLng: viewBounds.getEast()
                }
              })
            }
            map.on('moveend', reportView)
            map.on('zoomend', reportView)
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
            // fitBounds is what first gives the map a viewport; without this
            // the map would sit on its untiled geometry until the reader
            // happened to pan.
            reportView()
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
      if (reportView) {
        mapRef.current?.off?.('moveend', reportView)
        mapRef.current?.off?.('zoomend', reportView)
      }
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
    const map = mapRef.current
    // One or the other, never both: they draw the same roads at different
    // fidelities, so together every line renders at twice its opacity.
    map
      ?.getSource('route-heatmap')
      ?.setData(hasTiles ? EMPTY_GEOJSON : routeGeoJson)
    map?.getSource('route-heatmap-tiles')?.setData(tileGeoJson)
  }, [hasTiles, isMapLoaded, routeGeoJson, shouldRenderMap, tileGeoJson])

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
