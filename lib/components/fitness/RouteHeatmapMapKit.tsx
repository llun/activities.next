'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import {
  computeFocusBounds,
  downsampleSegments
} from '@/lib/components/fitness/mapGeometry'
import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitMapSurface,
  type MapKitOverlay,
  type MapKitSurfaceModule,
  boundsToRegion,
  loadMapKitSurface
} from '@/lib/components/fitness/mapkitSurface'
import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'
import { cn } from '@/lib/utils'

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

export interface RouteHeatmapMapKitProps {
  heatmap: FitnessRouteHeatmapData | null
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
  heightClassName = ROUTE_HEATMAP_MAP_HEIGHT_CLASS
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapKitMapSurface | null>(null)
  const mapkitRef = useRef<MapKitSurfaceModule | null>(null)
  const overlaysRef = useRef<MapKitOverlay[]>([])
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
            showsMapTypeControl: false
          })
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

    const framing = focus?.bounds ?? bounds
    if (framing) {
      map.region = boundsToRegion(mapkit, framing)
    }
  }, [
    bounds?.maxLat,
    bounds?.maxLng,
    bounds?.minLat,
    bounds?.minLng,
    downsampledSegments,
    focus,
    isMapLoaded
  ])

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
