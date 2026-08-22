'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import type { HeatmapTileRun } from '@/lib/components/fitness/heatmapTileGeometry'
import {
  computeFocusBounds,
  downsampleSegments
} from '@/lib/components/fitness/mapGeometry'
import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitMapSurface,
  type MapKitOverlay,
  type MapKitStyle,
  type MapKitSurfaceModule,
  boundsToRegion,
  loadMapKitSurface,
  mutedStandardMapType
} from '@/lib/components/fitness/mapkitSurface'
import {
  HeatmapTileFetcher,
  useHeatmapTiles
} from '@/lib/components/fitness/useHeatmapTiles'
import {
  HEAT_COUNT_SATURATION,
  HEAT_HIDDEN_BASE_OPACITY,
  HEAT_VISIBLE_BASE_OPACITY,
  TILE_MIN_ZOOM,
  heatOpacityForCount
} from '@/lib/services/fitness-files/heatmapTiles/constants'
import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'
import { cn } from '@/lib/utils'
import { TILE_SIZE } from '@/lib/utils/webMercator'

// Mirrors RouteHeatmapMap's GL budget: the geometry is fit to this vertex target
// by adaptively coarsening the Douglas–Peucker tolerance (shape-preserving) and
// only then capped by the uniform downsampleSegments fallback, so a dense cache
// stays interactive without cutting corners off the road.
const ROUTE_RENDER_POINT_BUDGET = 60_000
const ROUTE_RENDER_SIMPLIFY_TOLERANCE_METERS = 1
const ROUTE_HEATMAP_MAP_HEIGHT_CLASS = 'h-[420px]'

// The GL map expresses these as a data-driven `case` paint on `isHiddenByPrivacy`;
// MapKit has no data-driven styling, so each polyline picks one of two Styles.
const VISIBLE_LINE_STYLE = {
  strokeColor: '#ef4444',
  lineWidth: 2.8,
  strokeOpacity: 0.55
}
const HIDDEN_LINE_STYLE = {
  strokeColor: '#2563eb',
  lineWidth: 2.2,
  strokeOpacity: 0.4
}

type MapFallbackReason = 'module-load-failed' | 'render-failed' | 'load-timeout'

interface MapFallbackError {
  message: string
  stack?: string
}

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

/**
 * The count ramp, as the handful of styles MapKit can express.
 *
 * The GL map interpolates colour, width and opacity over the visit count in a
 * data-driven paint; MapKit has no such thing, so the same ramp is sampled at
 * each count the ramp can distinguish. `heatOpacityForCount` clamps at
 * `HEAT_COUNT_SATURATION`, so that is a SMALL fixed number of styles — built
 * once and shared by every overlay, never one per polyline.
 */
const TILE_COLOR_FOR_COUNT = (count: number): string => {
  if (count >= 12) return '#facc15'
  if (count >= 4) return '#f97316'
  return '#ef4444'
}

const TILE_WIDTH_FOR_COUNT = (count: number): number => {
  if (count >= 12) return 4.2
  if (count >= 4) return 3.4
  return 2.8
}

/**
 * The view's zoom on the pyramid's 256px tile grid, as a fraction.
 *
 * MapKit has no zoom of its own — only a region and an element size — so it is
 * computed the same way the projection defines it: how many 256px tiles the
 * whole world would need for this many pixels to span this many degrees.
 */
const fractionalZoomForView = (
  bounds: { minLng: number; maxLng: number },
  widthPx: number
): number => {
  const span = bounds.maxLng - bounds.minLng
  if (span <= 0 || widthPx <= 0) return TILE_MIN_ZOOM
  return Math.log2((widthPx * 360) / (TILE_SIZE * span))
}

export interface RouteHeatmapMapKitProps {
  heatmap: FitnessRouteHeatmapData | null
  /** See RouteHeatmapMapProps.fetchTiles. */
  fetchTiles?: HeatmapTileFetcher
  /**
   * Tailwind height class for the map surface (and its empty/fallback states).
   * Defaults to the in-app fixed height; the full-bleed embed passes a
   * viewport-height class (`h-dvh`).
   */
  heightClassName?: string
}

/**
 * Apple MapKit JS sibling of `RouteHeatmapMap`. Renders the route cache as one
 * `PolylineOverlay` per segment and frames the densest cluster, keeping the same
 * empty state, 20s load watchdog, and `data-map-fallback-reason` fallback div.
 */
export const RouteHeatmapMapKit: FC<RouteHeatmapMapKitProps> = ({
  heatmap,
  fetchTiles,
  heightClassName = ROUTE_HEATMAP_MAP_HEIGHT_CLASS
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapKitMapSurface | null>(null)
  const mapkitRef = useRef<MapKitSurfaceModule | null>(null)
  const overlaysRef = useRef<MapKitOverlay[]>([])
  // Keyed by tile so a pan adds and removes only what moved. MapKit gives an
  // overlay no identity of its own — no id, no lookup, no `map.overlays` — so
  // the keying is ours and lives here.
  const tileOverlaysRef = useRef(new Map<string, MapKitOverlay[]>())
  const hasFramedRef = useRef(false)
  const [mapFallbackReason, setMapFallbackReason] =
    useState<MapFallbackReason | null>(null)
  const [mapFallbackError, setMapFallbackError] =
    useState<MapFallbackError | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)

  const hasRoutes =
    heatmap?.status === 'completed' &&
    heatmap.segments.some((segment) => segment.points.length >= 2)
  const bounds = heatmap?.bounds

  const mapFallbackErrorMessage =
    process.env.NODE_ENV !== 'production'
      ? mapFallbackError?.message
      : undefined
  const shouldRenderMap = hasRoutes && Boolean(bounds) && !mapFallbackReason

  const downsampledSegments = useMemo(() => {
    if (!hasRoutes || !heatmap) return []
    const simplified = simplifySegmentsToBudget(
      heatmap.segments,
      ROUTE_RENDER_POINT_BUDGET,
      ROUTE_RENDER_SIMPLIFY_TOLERANCE_METERS
    )
    return downsampleSegments(simplified, ROUTE_RENDER_POINT_BUDGET)
  }, [hasRoutes, heatmap?.id, heatmap?.updatedAt])

  // The initial framing: tighten a disjoint multi-region cache to its densest
  // cluster, or keep the full bounds for a single contiguous region.
  const focus = useMemo(
    () => (bounds ? computeFocusBounds(downsampledSegments, bounds) : null),
    [downsampledSegments, bounds]
  )

  // Clear the fallback whenever the cache changes so a recovered map gets a
  // fresh attempt.
  useEffect(() => {
    setMapFallbackReason(null)
    setMapFallbackError(null)
  }, [heatmap?.id, heatmap?.updatedAt])

  useEffect(() => {
    // SSR guard: MapKit is a browser-only CDN script.
    if (typeof window === 'undefined') return
    if (!shouldRenderMap || !bounds) return

    const container = containerRef.current
    if (!container) return

    let cancelled = false
    setIsMapLoaded(false)

    // The loader resolving only means the SDK parsed; if MapKit never becomes
    // usable the overlay would otherwise spin forever.
    const loadWatchdog = setTimeout(() => {
      if (cancelled) return
      setMapFallbackError({
        message: 'Map timed out before MapKit finished loading'
      })
      setMapFallbackReason('load-timeout')
    }, MAPKIT_LOAD_TIMEOUT_MS)

    loadMapKitSurface()
      .then((mapkit) => {
        if (cancelled) return

        try {
          const map = new mapkit.Map(container, {
            mapType: mutedStandardMapType(mapkit),
            showsMapTypeControl: false
          })
          // The heatmap has no reason to rotate, and a rotated viewport's region
          // is the bounding box of the rotated rectangle — a superset that asks
          // for tiles the reader cannot see, by up to a factor of two.
          map.isRotationEnabled = false
          mapkitRef.current = mapkit
          mapRef.current = map

          clearTimeout(loadWatchdog)
          setIsMapLoaded(true)
        } catch (error) {
          clearTimeout(loadWatchdog)
          if (cancelled) return
          setMapFallbackError(getMapFallbackError(error))
          setMapFallbackReason('render-failed')
        }
      })
      .catch((error) => {
        clearTimeout(loadWatchdog)
        if (cancelled) return
        setMapFallbackError(getMapFallbackError(error))
        setMapFallbackReason('module-load-failed')
      })

    return () => {
      cancelled = true
      clearTimeout(loadWatchdog)
      overlaysRef.current = []
      // Per-MAP state, not per-component. The overlays belong to the map being
      // destroyed, so nothing needs removing from it — but leaving the keys
      // behind would make the diff on the next map believe those tiles were
      // already attached, and it would add nothing at all.
      tileOverlaysRef.current.clear()
      hasFramedRef.current = false
      mapRef.current?.destroy()
      mapRef.current = null
      mapkitRef.current = null
      setIsMapLoaded(false)
    }
  }, [
    bounds?.maxLat,
    bounds?.maxLng,
    bounds?.minLat,
    bounds?.minLng,
    heatmap?.id,
    shouldRenderMap
  ])

  // The GL sibling repaints an in-place cache update through `source.setData`;
  const tiles = useHeatmapTiles({
    tileSource: heatmap?.tileSource,
    fetchTiles
  })
  const hasTiles = tiles.runs.length > 0

  // Report the settled viewport. MapKit's `region-change-end` carries nothing
  // — no region, no zoom — so both are read back off the map, and the zoom has
  // to be DERIVED: MapKit has no zoom at all, only a region and an element
  // size.
  useEffect(() => {
    const map = mapRef.current
    if (!isMapLoaded || !map || !tiles.enabled) return

    const report = () => {
      const { center, span } = map.region
      const rect = map.element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const viewBounds = {
        minLat: center.latitude - span.latitudeDelta / 2,
        maxLat: center.latitude + span.latitudeDelta / 2,
        minLng: center.longitude - span.longitudeDelta / 2,
        maxLng: center.longitude + span.longitudeDelta / 2
      }
      tiles.onViewChange({
        // Derived, and deliberately NOT `getZoomLevelForBounds`: that walks
        // integer zooms and returns the first that fits, i.e. the FLOOR of the
        // true zoom. Feeding a floored value into a rule whose whole job is to
        // round UP gives back a rung up to two levels coarser than the view —
        // the simplification this phase exists to stop showing.
        zoom: fractionalZoomForView(viewBounds, rect.width),
        bounds: viewBounds
      })
    }

    map.addEventListener('region-change-end', report)
    report()
    return () => map.removeEventListener('region-change-end', report)
  }, [isMapLoaded, tiles.enabled, tiles.onViewChange])

  // Frame ONCE per map, not on every geometry change. Assigning `region`
  // animates the map and fires `region-change-end`, which now drives a tile
  // fetch — so re-framing whenever geometry changes would be a loop: pan,
  // fetch, tiles arrive, snap back to the original framing, fetch again. The
  // guard is reset when the map is destroyed, because it is per-MAP.
  const frame = (map: MapKitMapSurface, mapkit: MapKitSurfaceModule) => {
    if (hasFramedRef.current) return
    const framing = focus?.bounds ?? bounds
    if (!framing) return
    map.region = boundsToRegion(mapkit, framing)
    hasFramedRef.current = true
  }

  // MapKit has no data source, so the polyline overlays are rebuilt (and the
  // region re-framed) whenever the rendered geometry changes.
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isMapLoaded || !map || !mapkit) return

    if (overlaysRef.current.length > 0) {
      map.removeOverlays(overlaysRef.current)
      overlaysRef.current = []
    }

    // Frame BEFORE the tiled early return. A map recreated while tiles are
    // already held would otherwise never be framed and would open on MapKit's
    // default region — a blank map somewhere else entirely.
    frame(map, mapkit)

    // Tiles replace this geometry rather than drawing over it — see the GL
    // sibling: the two describe the same roads and together every line renders
    // at twice its opacity.
    if (hasTiles) return

    const visibleStyle = new mapkit.Style(VISIBLE_LINE_STYLE)
    const hiddenStyle = new mapkit.Style(HIDDEN_LINE_STYLE)
    const overlays = downsampledSegments
      .filter((segment) => segment.points.length >= 2)
      .map(
        (segment) =>
          new mapkit.PolylineOverlay(
            segment.points.map(
              (point) => new mapkit.Coordinate(point.lat, point.lng)
            ),
            { style: segment.isHiddenByPrivacy ? hiddenStyle : visibleStyle }
          )
      )
    if (overlays.length > 0) {
      map.addOverlays(overlays)
      overlaysRef.current = overlays
    }
  }, [
    bounds?.maxLat,
    bounds?.maxLng,
    bounds?.minLat,
    bounds?.minLng,
    downsampledSegments,
    focus,
    hasTiles,
    isMapLoaded
  ])

  // The tiled overlays, diffed per tile. Rebuilding all of them on every pan
  // would drop and recreate thousands of polylines for a few tiles' worth of
  // change.
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isMapLoaded || !map || !mapkit) return

    const styles = new Map<string, MapKitStyle>()
    const styleFor = (run: HeatmapTileRun) => {
      const count = Math.max(Math.round(run.count), 1)
      // Opacity saturates at HEAT_COUNT_SATURATION; colour and width do NOT —
      // their ramps run to 12 and 16. Clamping before all three would collapse
      // every busy street onto the coolest tier, so only the opacity input is
      // clamped, and the cache key keys on the resolved tier rather than the
      // raw count so the style table stays small.
      const opacityCount = Math.min(count, HEAT_COUNT_SATURATION)
      const key = `${run.hidden ? 'h' : 'v'}:${opacityCount}:${TILE_COLOR_FOR_COUNT(count)}:${TILE_WIDTH_FOR_COUNT(count)}`
      const existing = styles.get(key)
      if (existing) return existing
      const style = new mapkit.Style(
        run.hidden
          ? {
              strokeColor: HIDDEN_LINE_STYLE.strokeColor,
              lineWidth: HIDDEN_LINE_STYLE.lineWidth,
              strokeOpacity: heatOpacityForCount(
                opacityCount,
                HEAT_HIDDEN_BASE_OPACITY
              )
            }
          : {
              strokeColor: TILE_COLOR_FOR_COUNT(count),
              lineWidth: TILE_WIDTH_FOR_COUNT(count),
              strokeOpacity: heatOpacityForCount(
                opacityCount,
                HEAT_VISIBLE_BASE_OPACITY
              )
            }
      )
      styles.set(key, style)
      return style
    }

    const desired = new Map(
      tiles.groups.map((group) => [group.key, group.runs])
    )
    const held = tileOverlaysRef.current
    for (const [key, overlays] of held) {
      if (desired.has(key)) continue
      map.removeOverlays(overlays)
      held.delete(key)
    }

    for (const [key, runs] of desired) {
      if (held.has(key)) continue
      const overlays = runs.map(
        (run) =>
          new mapkit.PolylineOverlay(
            run.points.map(
              (point) => new mapkit.Coordinate(point.lat, point.lng)
            ),
            { style: styleFor(run) }
          )
      )
      if (overlays.length === 0) continue
      map.addOverlays(overlays)
      held.set(key, overlays)
    }
  }, [isMapLoaded, tiles.groups])

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
          {APPLE_MAPS_LABEL}
        </div>
      )}
    </div>
  )
}
