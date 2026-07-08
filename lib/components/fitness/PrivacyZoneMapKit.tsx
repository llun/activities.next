'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitAnnotation,
  type MapKitMapSurface,
  type MapKitOverlay,
  type MapKitSurfaceModule,
  type MapKitTapEvent,
  loadMapKitSurface,
  pageToCoordinate
} from '@/lib/components/fitness/mapkitSurface'

const DEFAULT_MAP_CENTER: { latitude: number; longitude: number } = {
  latitude: 52.1326,
  longitude: 5.2913
}
const DEFAULT_MAP_SPAN_DEG = 6
const MARKER_SPAN_DEG = 0.08
const ZONE_COLOR = '#16a34a'

export interface PrivacyZone {
  latitude: number
  longitude: number
  hideRadiusMeters: number
}

export interface PrivacyZoneMapKitProps {
  /** The pending marker position, or null while the coordinate fields are empty. */
  marker: { latitude: number; longitude: number } | null
  /** Already-saved privacy zones, drawn as circles at their hide radius. */
  zones: PrivacyZone[]
  /** Fired when the user taps the map to pick a coordinate. */
  onPick: (coordinate: { latitude: number; longitude: number }) => void
  /** Fired once the map surface is interactive. */
  onReady?: () => void
  /** Called when MapKit can't load/render so the caller can fall back. */
  onUnavailable: () => void
}

/**
 * Apple MapKit JS sibling of the GL privacy-location picker inside
 * `FitnessPrivacyLocationSettings`. Tapping the map (`single-tap`, MapKit's only
 * pointer-ish map event) picks a coordinate; the pending marker and every saved
 * zone are drawn as overlays. On failure `onUnavailable` lets the caller fall
 * back to the manual latitude/longitude fields.
 */
export const PrivacyZoneMapKit: FC<PrivacyZoneMapKitProps> = ({
  marker,
  zones,
  onPick,
  onReady,
  onUnavailable
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapKitMapSurface | null>(null)
  const mapkitRef = useRef<MapKitSurfaceModule | null>(null)
  const markerAnnotationRef = useRef<MapKitAnnotation | null>(null)
  const zoneOverlaysRef = useRef<MapKitOverlay[]>([])
  const [isMapReady, setIsMapReady] = useState(false)

  const markerRef = useRef(marker)
  const onPickRef = useRef(onPick)
  const onReadyRef = useRef(onReady)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => {
    markerRef.current = marker
  }, [marker])
  useEffect(() => {
    onPickRef.current = onPick
    onReadyRef.current = onReady
    onUnavailableRef.current = onUnavailable
  }, [onPick, onReady, onUnavailable])

  useEffect(() => {
    // SSR guard: MapKit is a browser-only CDN script.
    if (typeof window === 'undefined') return

    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let detachTap: (() => void) | undefined

    const loadWatchdog = setTimeout(() => {
      if (!cancelled) onUnavailableRef.current()
    }, MAPKIT_LOAD_TIMEOUT_MS)

    loadMapKitSurface()
      .then((mapkit) => {
        if (cancelled) return

        try {
          const initialMarker = markerRef.current
          const center = initialMarker
            ? new mapkit.Coordinate(
                initialMarker.latitude,
                initialMarker.longitude
              )
            : new mapkit.Coordinate(
                DEFAULT_MAP_CENTER.latitude,
                DEFAULT_MAP_CENTER.longitude
              )
          const spanDeg = initialMarker ? MARKER_SPAN_DEG : DEFAULT_MAP_SPAN_DEG

          const map = new mapkit.Map(container, {
            showsMapTypeControl: false,
            region: new mapkit.CoordinateRegion(
              center,
              new mapkit.CoordinateSpan(spanDeg, spanDeg)
            )
          })
          mapkitRef.current = mapkit
          mapRef.current = map

          const onSingleTap = (event: MapKitTapEvent) => {
            const point = event.pointOnPage
            if (!point) return
            const coordinate = pageToCoordinate(map, point.x, point.y)
            if (!coordinate) return
            onPickRef.current({
              latitude: coordinate.latitude,
              longitude: coordinate.longitude
            })
          }
          map.addEventListener('single-tap', onSingleTap)
          detachTap = () => map.removeEventListener('single-tap', onSingleTap)

          clearTimeout(loadWatchdog)
          setIsMapReady(true)
          onReadyRef.current?.()
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
      detachTap?.()
      markerAnnotationRef.current = null
      zoneOverlaysRef.current = []
      mapRef.current?.destroy()
      mapRef.current = null
      mapkitRef.current = null
    }
  }, [])

  // Keep the pending marker in sync (and follow it, mirroring the GL `flyTo`).
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isMapReady || !map || !mapkit) return

    if (markerAnnotationRef.current) {
      map.removeAnnotation(markerAnnotationRef.current)
      markerAnnotationRef.current = null
    }
    if (!marker) return

    const coordinate = new mapkit.Coordinate(marker.latitude, marker.longitude)
    const annotation = new mapkit.MarkerAnnotation(coordinate, {
      color: ZONE_COLOR
    })
    map.addAnnotation(annotation)
    markerAnnotationRef.current = annotation
    map.setRegionAnimated(
      new mapkit.CoordinateRegion(
        coordinate,
        new mapkit.CoordinateSpan(MARKER_SPAN_DEG, MARKER_SPAN_DEG)
      ),
      true
    )
    // Keyed on the coordinate values, not the object identity, so an inline prop
    // literal doesn't re-add the annotation on every parent render.
  }, [isMapReady, marker?.latitude, marker?.longitude])

  // Draw the saved zones as circles at their hide radius.
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isMapReady || !map || !mapkit) return

    for (const overlay of zoneOverlaysRef.current) {
      map.removeOverlay(overlay)
    }

    const style = new mapkit.Style({
      strokeColor: ZONE_COLOR,
      lineWidth: 2,
      fillColor: ZONE_COLOR,
      fillOpacity: 0.2
    })
    const overlays = zones.map(
      (zone) =>
        new mapkit.CircleOverlay(
          new mapkit.Coordinate(zone.latitude, zone.longitude),
          zone.hideRadiusMeters,
          { style }
        )
    )
    for (const overlay of overlays) {
      map.addOverlay(overlay)
    }
    zoneOverlaysRef.current = overlays
  }, [isMapReady, zones])

  return (
    <>
      <div
        ref={containerRef}
        role="img"
        aria-label="Privacy location picker map"
        className="h-full w-full"
      />
      {!isMapReady ? (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" /> Loading map…
        </div>
      ) : (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
          {APPLE_MAPS_LABEL}
        </span>
      )}
    </>
  )
}
