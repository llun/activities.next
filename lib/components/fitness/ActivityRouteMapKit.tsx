'use client'

import { Loader2, Minus, Plus } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import type { FitnessRouteSample, FitnessRouteSegment } from '@/lib/client'
import { findRouteSampleForElapsed } from '@/lib/components/fitness/mapGeometry'
import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitAnnotation,
  type MapKitMapSurface,
  type MapKitOverlay,
  type MapKitSurfaceModule,
  boundsToRegion,
  loadMapKitSurface
} from '@/lib/components/fitness/mapkitSurface'

// Mirrors the GL activity route paint: orange for the shared trace, green for the
// segments hidden from other viewers by a privacy location.
const VISIBLE_ROUTE_STYLE = {
  strokeColor: '#f97316',
  lineWidth: 4,
  strokeOpacity: 0.9
}
const HIDDEN_ROUTE_STYLE = {
  strokeColor: '#16a34a',
  lineWidth: 4,
  strokeOpacity: 0.95
}
const ACTIVE_MARKER_COLOR = '#1d4ed8'
const ACTIVE_HIDDEN_MARKER_COLOR = '#16a34a'
// MapKit zooms by shrinking/growing the region span; these mirror the GL buttons.
const ZOOM_IN_FACTOR = 0.5
const ZOOM_OUT_FACTOR = 2

const getRouteBounds = (samples: FitnessRouteSample[]) => {
  const initial = samples[0]
  let minLng = initial.lng
  let maxLng = initial.lng
  let minLat = initial.lat
  let maxLat = initial.lat

  for (let index = 1; index < samples.length; index += 1) {
    minLng = Math.min(minLng, samples[index].lng)
    maxLng = Math.max(maxLng, samples[index].lng)
    minLat = Math.min(minLat, samples[index].lat)
    maxLat = Math.max(maxLat, samples[index].lat)
  }

  return { minLat, maxLat, minLng, maxLng }
}

/**
 * Value signature of the drawable route. Callers hand us freshly-built arrays on
 * every render, so effects key on this string instead of array identity — that is
 * what keeps a chart hover from rebuilding the overlays (or the map itself).
 */
const getRouteSignature = (segments: FitnessRouteSegment[]) =>
  segments
    .map((segment) => {
      const first = segment.samples[0]
      const last = segment.samples[segment.samples.length - 1]
      return [
        segment.isHiddenByPrivacy ? 'hidden' : 'visible',
        segment.samples.length,
        first.lat,
        first.lng,
        last.lat,
        last.lng
      ].join(',')
    })
    .join('|')

export interface ActivityRouteMapKitProps {
  /** Drawable route segments (each with at least two samples). */
  routeSegments: FitnessRouteSegment[]
  /** Flat, time-ordered samples used to resolve the highlighted position. */
  routeSamples: FitnessRouteSample[]
  /** Elapsed offset hovered on the analysis charts, or null when not hovering. */
  highlightedElapsedSeconds?: number | null
  /** Called when MapKit can't load/render so the caller can fall back. */
  onUnavailable: () => void
}

/**
 * Apple MapKit JS sibling of the GL `ActivityMapPanel` map: the activity route as
 * `PolylineOverlay`s plus a `MarkerAnnotation` that follows the chart hover. Zoom
 * controls drive `setRegionAnimated` because MapKit has no `zoomIn`/`zoomOut`.
 */
export const ActivityRouteMapKit: FC<ActivityRouteMapKitProps> = ({
  routeSegments,
  routeSamples,
  highlightedElapsedSeconds = null,
  onUnavailable
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapKitMapSurface | null>(null)
  const mapkitRef = useRef<MapKitSurfaceModule | null>(null)
  const markerRef = useRef<MapKitAnnotation | null>(null)
  const overlaysRef = useRef<MapKitOverlay[]>([])
  const onUnavailableRef = useRef(onUnavailable)
  const [isMapLoaded, setIsMapLoaded] = useState(false)

  useEffect(() => {
    onUnavailableRef.current = onUnavailable
  }, [onUnavailable])

  const drawableRouteSegments = useMemo(
    () => routeSegments.filter((segment) => segment.samples.length >= 2),
    [routeSegments]
  )
  const routeSamplesForBounds = useMemo(
    () => drawableRouteSegments.flatMap((segment) => segment.samples),
    [drawableRouteSegments]
  )
  const routeSignature = useMemo(
    () => getRouteSignature(drawableRouteSegments),
    [drawableRouteSegments]
  )
  const hasDrawableRoute = routeSamplesForBounds.length > 0

  const segmentsRef = useRef(drawableRouteSegments)
  const boundsSamplesRef = useRef(routeSamplesForBounds)
  useEffect(() => {
    segmentsRef.current = drawableRouteSegments
    boundsSamplesRef.current = routeSamplesForBounds
  }, [drawableRouteSegments, routeSamplesForBounds])

  const activeSample = useMemo(() => {
    if (typeof highlightedElapsedSeconds !== 'number') return null
    return findRouteSampleForElapsed(routeSamples, highlightedElapsedSeconds)
  }, [highlightedElapsedSeconds, routeSamples])

  // Create the map once. The route arrays are read from refs (never from the
  // dependency array) so a chart hover — which hands this component brand-new
  // array identities on every parent render — can't tear the map down and
  // rebuild it. Route data changes are handled by the overlay effect below.
  useEffect(() => {
    // SSR guard: MapKit is a browser-only CDN script.
    if (typeof window === 'undefined') return
    if (!hasDrawableRoute) return

    const container = containerRef.current
    if (!container) return

    let cancelled = false
    setIsMapLoaded(false)

    const loadWatchdog = setTimeout(() => {
      if (!cancelled) onUnavailableRef.current()
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
        } catch {
          clearTimeout(loadWatchdog)
          if (cancelled) return
          mapRef.current?.destroy()
          mapRef.current = null
          onUnavailableRef.current()
        }
      })
      .catch(() => {
        clearTimeout(loadWatchdog)
        if (!cancelled) onUnavailableRef.current()
      })

    return () => {
      cancelled = true
      clearTimeout(loadWatchdog)
      markerRef.current = null
      overlaysRef.current = []
      mapRef.current?.destroy()
      mapRef.current = null
      mapkitRef.current = null
      setIsMapLoaded(false)
    }
  }, [hasDrawableRoute])

  // (Re)draw the route overlays and re-frame the region whenever the route data
  // actually changes — keyed on the geometry's value signature, not its identity.
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isMapLoaded || !map || !mapkit) return

    if (overlaysRef.current.length > 0) {
      map.removeOverlays(overlaysRef.current)
      overlaysRef.current = []
    }

    const boundsSamples = boundsSamplesRef.current
    if (boundsSamples.length === 0) return

    const visibleStyle = new mapkit.Style(VISIBLE_ROUTE_STYLE)
    const hiddenStyle = new mapkit.Style(HIDDEN_ROUTE_STYLE)
    const overlays = segmentsRef.current.map(
      (segment) =>
        new mapkit.PolylineOverlay(
          segment.samples.map(
            (sample) => new mapkit.Coordinate(sample.lat, sample.lng)
          ),
          { style: segment.isHiddenByPrivacy ? hiddenStyle : visibleStyle }
        )
    )
    if (overlays.length > 0) {
      map.addOverlays(overlays)
      overlaysRef.current = overlays
    }

    map.region = boundsToRegion(mapkit, getRouteBounds(boundsSamples))
  }, [isMapLoaded, routeSignature])

  // Move (or clear) the highlighted-position marker as the chart hover changes.
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isMapLoaded || !map || !mapkit) return

    if (markerRef.current) {
      map.removeAnnotation(markerRef.current)
      markerRef.current = null
    }
    if (!activeSample) return

    const marker = new mapkit.MarkerAnnotation(
      new mapkit.Coordinate(activeSample.lat, activeSample.lng),
      {
        color: activeSample.isHiddenByPrivacy
          ? ACTIVE_HIDDEN_MARKER_COLOR
          : ACTIVE_MARKER_COLOR
      }
    )
    map.addAnnotation(marker)
    markerRef.current = marker
  }, [activeSample, isMapLoaded])

  const zoomBy = (factor: number) => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!map || !mapkit) return

    const { center, span } = map.region
    map.setRegionAnimated(
      new mapkit.CoordinateRegion(
        new mapkit.Coordinate(center.latitude, center.longitude),
        new mapkit.CoordinateSpan(
          span.latitudeDelta * factor,
          span.longitudeDelta * factor
        )
      ),
      true
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        role="img"
        aria-label="Activity route map"
        className="h-full w-full"
      />
      {!isMapLoaded ? (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-muted/60 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" /> Loading map…
        </div>
      ) : (
        <>
          <div className="absolute left-3 top-3 flex flex-col overflow-hidden rounded-md border bg-background/95 shadow-sm">
            <button
              type="button"
              onClick={() => zoomBy(ZOOM_IN_FACTOR)}
              className="flex size-8 items-center justify-center text-foreground hover:bg-muted"
              aria-label="Zoom in map"
            >
              <Plus className="size-4" />
            </button>
            <div className="h-px bg-border" />
            <button
              type="button"
              onClick={() => zoomBy(ZOOM_OUT_FACTOR)}
              className="flex size-8 items-center justify-center text-foreground hover:bg-muted"
              aria-label="Zoom out map"
            >
              <Minus className="size-4" />
            </button>
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm">
            {APPLE_MAPS_LABEL}
          </div>
        </>
      )}
    </>
  )
}
