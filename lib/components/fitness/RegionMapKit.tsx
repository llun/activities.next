'use client'

import { Crosshair, Loader2, LocateFixed } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

import { Box, boxFromPoints } from '@/lib/components/fitness/mapGeometry'
import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitMapSurface,
  type MapKitOverlay,
  type MapKitSurfaceModule,
  boundsToRegion,
  loadMapKitSurface,
  pageToCoordinate
} from '@/lib/components/fitness/mapkitSurface'
import { Button } from '@/lib/components/ui/button'
import { LatLng } from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'

const SELECTION_COLOR = '#ea580c'
const USER_LOCATION_SPAN_DEG = 0.6
const SEED_BOX_DELTA_DEG = 0.05

interface RegionMapKitProps {
  box: Box
  onChange: (box: Box) => void
  /** Center on the user's current location when composing a brand-new area. */
  centerOnUser: boolean
  /** Called when the map can't load/render so the caller can fall back. */
  onUnavailable: () => void
  height?: number
}

/**
 * Apple MapKit JS sibling of `RegionMap`: the draw-a-rectangle surface for the
 * heatmap region picker. MapKit exposes no map-level pointer events, so drawing
 * listens on `map.element` and converts page points through
 * `convertPointOnPageToCoordinate`. Panning/zooming is disabled while drawing.
 * If MapKit fails to load or render, `onUnavailable` lets the caller keep the
 * coordinate fields as the manual fallback — the same contract as `RegionMap`.
 */
export const RegionMapKit: FC<RegionMapKitProps> = ({
  box,
  onChange,
  centerOnUser,
  onUnavailable,
  height = 260
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapKitMapSurface | null>(null)
  const mapkitRef = useRef<MapKitSurfaceModule | null>(null)
  const boxOverlayRef = useRef<MapKitOverlay | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [drawMode, setDrawMode] = useState(false)

  // Latest values read inside long-lived DOM listeners / the mount-once create
  // effect without re-subscribing or recreating the map on every render.
  const boxRef = useRef(box)
  const onChangeRef = useRef(onChange)
  const onUnavailableRef = useRef(onUnavailable)
  const centerOnUserRef = useRef(centerOnUser)
  const drawModeRef = useRef(drawMode)
  const drawingRef = useRef(false)
  const startRef = useRef<LatLng | null>(null)
  const didDrawRef = useRef(false)
  const didSeedRef = useRef(false)

  useEffect(() => {
    boxRef.current = box
  }, [box])
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    onUnavailableRef.current = onUnavailable
  }, [onUnavailable])
  useEffect(() => {
    centerOnUserRef.current = centerOnUser
  }, [centerOnUser])

  // Panning/zooming is suspended for the duration of a draw drag only, and is
  // restored the moment the drag ends — wherever it ends (on the map, outside it,
  // on a cancelled pointer, or on unmount).
  const setMapGesturesEnabled = (enabled: boolean) => {
    const map = mapRef.current
    if (!map) return
    map.isScrollEnabled = enabled
    map.isZoomEnabled = enabled
    map.isRotationEnabled = enabled
  }

  const endDraw = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    startRef.current = null
    setMapGesturesEnabled(true)
  }

  const drawBoxOverlay = (nextBox: Box) => {
    const mapkit = mapkitRef.current
    const map = mapRef.current
    if (!mapkit || !map) return

    if (boxOverlayRef.current) {
      map.removeOverlay(boxOverlayRef.current)
      boxOverlayRef.current = null
    }

    const corners = [
      { lat: nextBox.nw.lat, lng: nextBox.nw.lng },
      { lat: nextBox.nw.lat, lng: nextBox.se.lng },
      { lat: nextBox.se.lat, lng: nextBox.se.lng },
      { lat: nextBox.se.lat, lng: nextBox.nw.lng }
    ].map((corner) => new mapkit.Coordinate(corner.lat, corner.lng))

    const overlay = new mapkit.PolygonOverlay(corners, {
      style: new mapkit.Style({
        strokeColor: SELECTION_COLOR,
        lineWidth: 2,
        fillColor: SELECTION_COLOR,
        fillOpacity: 0.15
      })
    })
    map.addOverlay(overlay)
    boxOverlayRef.current = overlay
  }

  const locateUser = (map: MapKitMapSurface, seedBox: boolean) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Geolocation can resolve after the composer closed (the map was
        // destroyed). Bail so we don't drive a torn-down map.
        const mapkit = mapkitRef.current
        if (mapRef.current !== map || !mapkit) return
        const { latitude, longitude } = position.coords
        map.setRegionAnimated(
          new mapkit.CoordinateRegion(
            new mapkit.Coordinate(latitude, longitude),
            new mapkit.CoordinateSpan(
              USER_LOCATION_SPAN_DEG,
              USER_LOCATION_SPAN_DEG
            )
          ),
          false
        )
        // Seed a small starting area at the current location only if the user
        // hasn't drawn yet — never clobber an in-progress selection.
        if (seedBox && !didDrawRef.current && !didSeedRef.current) {
          didSeedRef.current = true
          onChangeRef.current(
            boxFromPoints(
              {
                lat: latitude + SEED_BOX_DELTA_DEG,
                lng: longitude - SEED_BOX_DELTA_DEG
              },
              {
                lat: latitude - SEED_BOX_DELTA_DEG,
                lng: longitude + SEED_BOX_DELTA_DEG
              }
            )
          )
        }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    )
  }

  // Create the map once — the provider is stable for the picker's lifetime.
  useEffect(() => {
    // SSR guard: MapKit is a browser-only CDN script.
    if (typeof window === 'undefined') return

    let cancelled = false

    // A pointer released outside the map element (or off-window) still ends the
    // drag, so drawingRef can't get stuck and the map gestures always come back.
    window.addEventListener('pointerup', endDraw)
    window.addEventListener('pointercancel', endDraw)

    // If MapKit never becomes usable, fall back to the coordinate fields instead
    // of showing "Loading map…" forever.
    const loadWatchdog = setTimeout(() => {
      if (!cancelled) onUnavailableRef.current()
    }, MAPKIT_LOAD_TIMEOUT_MS)

    let detachPointerListeners: (() => void) | undefined

    loadMapKitSurface()
      .then((mapkit) => {
        const container = containerRef.current
        if (cancelled || !container) return

        try {
          const map = new mapkit.Map(container, {
            showsMapTypeControl: false
          })
          mapkitRef.current = mapkit
          mapRef.current = map

          const toPoint = (pageX: number, pageY: number): LatLng | null => {
            const coordinate = pageToCoordinate(map, pageX, pageY)
            if (!coordinate) return null
            return { lat: coordinate.latitude, lng: coordinate.longitude }
          }

          // MapKit has no mousedown/mousemove map events, so the draw gesture is
          // read straight off the map's DOM element.
          const onPointerDown = (event: PointerEvent) => {
            if (!drawModeRef.current) return
            const point = toPoint(event.pageX, event.pageY)
            if (!point) return
            event.preventDefault()
            drawingRef.current = true
            didDrawRef.current = true
            startRef.current = point
            // Suspend MapKit's own pan/zoom/rotate gestures so the drag draws the
            // rectangle instead of moving the map.
            setMapGesturesEnabled(false)
            onChangeRef.current(boxFromPoints(point, point))
          }
          const onPointerMove = (event: PointerEvent) => {
            if (!drawingRef.current || !startRef.current) return
            const point = toPoint(event.pageX, event.pageY)
            if (!point) return
            onChangeRef.current(boxFromPoints(startRef.current, point))
          }

          map.element.addEventListener('pointerdown', onPointerDown)
          map.element.addEventListener('pointermove', onPointerMove)
          map.element.addEventListener('pointerup', endDraw)
          map.element.addEventListener('pointercancel', endDraw)
          detachPointerListeners = () => {
            map.element.removeEventListener('pointerdown', onPointerDown)
            map.element.removeEventListener('pointermove', onPointerMove)
            map.element.removeEventListener('pointerup', endDraw)
            map.element.removeEventListener('pointercancel', endDraw)
          }

          const current = boxRef.current
          drawBoxOverlay(current)
          // Always frame the current box first so it's visible even if
          // geolocation is denied/unavailable; a successful locate then eases to
          // the user's position.
          map.region = boundsToRegion(mapkit, {
            minLat: current.se.lat,
            maxLat: current.nw.lat,
            minLng: current.nw.lng,
            maxLng: current.se.lng
          })

          clearTimeout(loadWatchdog)
          setIsReady(true)

          if (centerOnUserRef.current) {
            locateUser(map, true)
          }
        } catch {
          clearTimeout(loadWatchdog)
          if (!cancelled) onUnavailableRef.current()
        }
      })
      .catch(() => {
        clearTimeout(loadWatchdog)
        if (!cancelled) onUnavailableRef.current()
      })

    return () => {
      cancelled = true
      clearTimeout(loadWatchdog)
      window.removeEventListener('pointerup', endDraw)
      window.removeEventListener('pointercancel', endDraw)
      // Unmounting mid-drag still restores the map's gestures before teardown.
      endDraw()
      detachPointerListeners?.()
      boxOverlayRef.current = null
      mapRef.current?.destroy()
      mapRef.current = null
      mapkitRef.current = null
    }
  }, [])

  // Keep the drawn rectangle overlay in sync with the box (drawn or typed). Keyed
  // on the corner values, not the object identity, so an inline prop literal
  // doesn't redraw the overlay on every parent render.
  useEffect(() => {
    if (!isReady) return
    drawBoxOverlay(box)
  }, [isReady, box.nw.lat, box.nw.lng, box.se.lat, box.se.lng])

  // Draw mode only arms the gesture and swaps the cursor; MapKit's pan/zoom/rotate
  // are suspended for the duration of an actual drag (see `onPointerDown`).
  useEffect(() => {
    drawModeRef.current = drawMode
    const map = mapRef.current
    if (!map || !isReady) return
    map.element.style.cursor = drawMode ? 'crosshair' : ''
    if (!drawMode) endDraw()
  }, [drawMode, isReady])

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={{ height }}
    >
      <div ref={containerRef} className="h-full w-full" />

      {!isReady && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-muted/60 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" /> Loading map…
        </div>
      )}

      {isReady && (
        <>
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
            {APPLE_MAPS_LABEL}
          </span>
          <div className="absolute right-2 top-2 flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={drawMode ? 'default' : 'outline'}
              className="h-7 px-2 text-xs shadow-sm"
              aria-pressed={drawMode}
              onClick={() => setDrawMode((value) => !value)}
            >
              <Crosshair className="size-3.5" />
              {drawMode ? 'Drawing…' : 'Draw'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs shadow-sm"
              onClick={() => {
                const map = mapRef.current
                if (map) locateUser(map, false)
              }}
            >
              <LocateFixed className="size-3.5" />
              <span className="sr-only">Center on my location</span>
            </Button>
          </div>
          <div
            className={cn(
              'pointer-events-none absolute inset-x-2 bottom-2 rounded bg-background/90 px-2 py-1 text-center text-[11px] shadow-sm',
              drawMode ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {drawMode
              ? 'Drag on the map to set the area.'
              : 'Pan and zoom, then press Draw to select an area.'}
          </div>
        </>
      )}
    </div>
  )
}
