'use client'

import { Loader2, Minus, Plus } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import type { FitnessRouteSample, FitnessRouteSegment } from '@/lib/client'
import {
  ROUTE_PRIVACY_HINT_TAP_TIMEOUT_MS,
  ROUTE_PRIVACY_HINT_TOLERANCE_PX,
  RoutePrivacyHint,
  type RoutePrivacyHintPoint
} from '@/lib/components/fitness/RoutePrivacyHint'
import {
  findRouteSampleForElapsed,
  getDistanceToHiddenSegments,
  getScaledCoordinateDistance
} from '@/lib/components/fitness/mapGeometry'
import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitAnnotation,
  type MapKitMapSurface,
  type MapKitOverlay,
  type MapKitSurfaceModule,
  type MapKitTapEvent,
  boundsToRegion,
  loadMapKitSurface,
  pageToCoordinate
} from '@/lib/components/fitness/mapkitSurface'
import { createRouteHighlightElement } from '@/lib/components/fitness/routeHighlightMarker'

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

/**
 * Wire the privacy hint to a MapKit map.
 *
 * MapKit exposes no pointer events on overlays and no hover event at all, so
 * "is the pointer on a green line?" is answered geometrically: convert the page
 * point to a coordinate, measure it against the hidden segments, and compare
 * against a tolerance obtained by converting a second point one tolerance-width
 * away. Deriving the tolerance through the same projection is what keeps it a
 * true pixel distance at any zoom, without reading the region span or the
 * element's box.
 *
 * Deliberately does NOT touch `isScrollEnabled` / `touchAction` the way
 * RegionMapKit's draw mode does — this is a passive readout and must leave
 * panning and pinch-zoom completely alone.
 */
const attachPrivacyHintListeners = (
  map: MapKitMapSurface,
  segmentsRef: { current: FitnessRouteSegment[] },
  setPoint: (point: RoutePrivacyHintPoint | null) => void,
  timeoutRef: { current: ReturnType<typeof setTimeout> | undefined }
) => {
  const resolvePoint = (pageX: number, pageY: number) => {
    // Read through the ref, never a captured array: the create effect runs once
    // and would otherwise hit-test the first render's geometry forever.
    const segments = segmentsRef.current
    if (!segments.some((segment) => segment.isHiddenByPrivacy)) return null

    const coordinate = pageToCoordinate(map, pageX, pageY)
    const toleranceProbe = pageToCoordinate(
      map,
      pageX + ROUTE_PRIVACY_HINT_TOLERANCE_PX,
      pageY
    )
    if (!coordinate || !toleranceProbe) return null

    const target = { lat: coordinate.latitude, lng: coordinate.longitude }
    const tolerance = getScaledCoordinateDistance(target, {
      lat: toleranceProbe.latitude,
      lng: toleranceProbe.longitude
    })
    const distance = getDistanceToHiddenSegments(segments, target)
    if (distance === null || distance > tolerance) return null

    const bounds = map.element.getBoundingClientRect()
    return {
      x: pageX - bounds.left - window.scrollX,
      y: pageY - bounds.top - window.scrollY
    }
  }

  const clearHint = () => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
    setPoint(null)
  }

  const onPointerMove = (event: PointerEvent | MouseEvent) => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
    setPoint(resolvePoint(event.pageX, event.pageY))
  }

  // Touch has no pointer-leave, so a tap-opened hint retires on a timer.
  // MapKit's own `single-tap` is used rather than a synthetic pointerdown/up
  // pair because MapKit already tells a tap apart from the end of a pan.
  const onSingleTap = (event: MapKitTapEvent) => {
    const pointOnPage = event.pointOnPage
    if (!pointOnPage) return

    const point = resolvePoint(pointOnPage.x, pointOnPage.y)
    setPoint(point)
    clearTimeout(timeoutRef.current)
    if (!point) {
      timeoutRef.current = undefined
      return
    }
    timeoutRef.current = setTimeout(() => {
      setPoint(null)
    }, ROUTE_PRIVACY_HINT_TAP_TIMEOUT_MS)
  }

  map.element.addEventListener('pointermove', onPointerMove)
  map.element.addEventListener('pointerleave', clearHint)
  map.element.addEventListener('pointercancel', clearHint)
  map.addEventListener('single-tap', onSingleTap)

  return () => {
    map.element.removeEventListener('pointermove', onPointerMove)
    map.element.removeEventListener('pointerleave', clearHint)
    map.element.removeEventListener('pointercancel', clearHint)
    map.removeEventListener('single-tap', onSingleTap)
  }
}

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
 * `PolylineOverlay`s plus a custom dot annotation that follows the chart hover.
 * Zoom controls drive `setRegionAnimated` because MapKit has no
 * `zoomIn`/`zoomOut`.
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
  const [privacyHintPoint, setPrivacyHintPoint] =
    useState<RoutePrivacyHintPoint | null>(null)
  const privacyHintTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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

    // Assigned once the map exists — the cleanup below runs whether or not the
    // load ever resolved, so it cannot reach the map directly. Mirrors
    // RegionMapKit, the repo's other `map.element` pointer consumer.
    let detachPrivacyHintListeners: (() => void) | undefined

    loadMapKitSurface()
      .then((mapkit) => {
        if (cancelled) return

        try {
          const map = new mapkit.Map(container, {
            showsMapTypeControl: false
          })
          mapkitRef.current = mapkit
          mapRef.current = map

          detachPrivacyHintListeners = attachPrivacyHintListeners(
            map,
            segmentsRef,
            setPrivacyHintPoint,
            privacyHintTimeoutRef
          )

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
      detachPrivacyHintListeners?.()
      clearTimeout(privacyHintTimeoutRef.current)
      privacyHintTimeoutRef.current = undefined
      setPrivacyHintPoint(null)
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
    // The polylines under the hint were just replaced, so an open hint would be
    // pointing at geometry that no longer exists.
    clearTimeout(privacyHintTimeoutRef.current)
    privacyHintTimeoutRef.current = undefined
    setPrivacyHintPoint(null)
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

    // A custom annotation, not a `MarkerAnnotation`: Apple's teardrop pin is
    // anchored by its tip, so it renders above the sample it marks instead of on
    // it. The shared dot element matches the GL circle layers exactly.
    const isHiddenByPrivacy = Boolean(activeSample.isHiddenByPrivacy)
    const marker = new mapkit.Annotation(
      new mapkit.Coordinate(activeSample.lat, activeSample.lng),
      () => createRouteHighlightElement(isHiddenByPrivacy),
      // The dot is a chart-hover follower: it should neither animate in on every
      // move nor become selectable.
      { animates: false, enabled: false }
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
          {/* The screen-reader equivalent is rendered once by the parent panel,
              which wraps both renderers — not here, or it would be duplicated
              on the Apple branch. */}
          <RoutePrivacyHint point={privacyHintPoint} />
        </>
      )}
    </>
  )
}
