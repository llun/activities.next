'use client'

import { Crosshair, Loader2, LocateFixed } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { LatLng } from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'

type Box = { nw: LatLng; se: LatLng }

// The Mapbox GL / MapLibre GL surface — only the members this component drives.
// The two libraries share this subset, so one component drives either provider.
// Pointer events carry a `lngLat`; the `load` event does not, so it is optional.
type MapPointerEvent = {
  lngLat?: { lat: number; lng: number }
  preventDefault?: () => void
}

type GlMap = {
  on: (event: string, callback: (event: MapPointerEvent) => void) => void
  remove: () => void
  resize: () => void
  addSource: (id: string, source: unknown) => void
  addLayer: (layer: unknown) => void
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined
  getCanvas: () => HTMLCanvasElement
  easeTo: (options: Record<string, unknown>) => void
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: Record<string, unknown>
  ) => void
  dragPan: { enable: () => void; disable: () => void }
}

export type GlModule = {
  Map: new (options: Record<string, unknown>) => GlMap
}

const BOX_SOURCE_ID = 'region-box'
const SELECTION_COLOR = '#ea580c'
// Fall back to the coordinate fields if the map never finishes loading.
const MAP_LOAD_TIMEOUT_MS = 20000

const round2 = (value: number): number => Number(value.toFixed(2))

// Normalize any two points to nw (top-left) / se (bottom-right), rounded to the
// same 2-dp precision the coordinate fields and serialization use.
const boxFromPoints = (a: LatLng, b: LatLng): Box => ({
  nw: {
    lat: round2(Math.max(a.lat, b.lat)),
    lng: round2(Math.min(a.lng, b.lng))
  },
  se: {
    lat: round2(Math.min(a.lat, b.lat)),
    lng: round2(Math.max(a.lng, b.lng))
  }
})

const boxToPolygon = (box: Box) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [box.nw.lng, box.nw.lat],
        [box.se.lng, box.nw.lat],
        [box.se.lng, box.se.lat],
        [box.nw.lng, box.se.lat],
        [box.nw.lng, box.nw.lat]
      ]
    ]
  }
})

interface RegionMapProps {
  box: Box
  onChange: (box: Box) => void
  /** Loads the GL module (Mapbox GL or MapLibre GL). */
  loadModule: () => Promise<GlModule>
  /** GL Map constructor options minus `container` (style, accessToken, …). */
  mapOptions: Record<string, unknown>
  /** Short provider name shown on the map badge (e.g. "Mapbox"). */
  providerLabel: string
  /** Center on the user's current location when composing a brand-new area. */
  centerOnUser: boolean
  /** Called when the map can't load/render so the caller can fall back. */
  onUnavailable: () => void
  height?: number
}

/**
 * Interactive draw surface for the heatmap region picker, backed by either
 * Mapbox GL (when a token is configured) or the keyless MapLibre GL +
 * OpenFreeMap provider. Toggle "Draw" to disable map panning and drag a
 * rectangle; the selection is mirrored into the coordinate fields and back, so
 * typing and drawing stay in sync. A new area starts centered on the user's
 * current location. If the map fails to load, the caller keeps the coordinate
 * fields as the manual fallback via `onUnavailable`.
 */
export const RegionMap: FC<RegionMapProps> = ({
  box,
  onChange,
  loadModule,
  mapOptions,
  providerLabel,
  centerOnUser,
  onUnavailable,
  height = 260
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GlMap | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [drawMode, setDrawMode] = useState(false)

  // Latest values read inside long-lived GL event handlers / the mount-once
  // create effect without re-subscribing or recreating the map every render.
  const boxRef = useRef(box)
  const onChangeRef = useRef(onChange)
  const onUnavailableRef = useRef(onUnavailable)
  const loadModuleRef = useRef(loadModule)
  const mapOptionsRef = useRef(mapOptions)
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
    loadModuleRef.current = loadModule
    mapOptionsRef.current = mapOptions
    centerOnUserRef.current = centerOnUser
  }, [loadModule, mapOptions, centerOnUser])

  const locateUser = (map: GlMap, seedBox: boolean) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Geolocation can resolve after the composer closed (the map was
        // removed). Bail so we don't drive a torn-down map or setState on an
        // unmounted component. `mapRef` is nulled in the effect cleanup.
        if (mapRef.current !== map) return
        const { latitude, longitude } = position.coords
        map.easeTo({ center: [longitude, latitude], zoom: 11, duration: 0 })
        // Seed a small starting area at the current location only if the user
        // hasn't drawn yet — never clobber an in-progress selection.
        if (seedBox && !didDrawRef.current && !didSeedRef.current) {
          didSeedRef.current = true
          const delta = 0.05
          onChangeRef.current(
            boxFromPoints(
              { lat: latitude + delta, lng: longitude - delta },
              { lat: latitude - delta, lng: longitude + delta }
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
    let cancelled = false
    let loadWatchdog: ReturnType<typeof setTimeout> | undefined

    // A pointer released outside the map canvas (or off-window) still ends the
    // drag, so drawingRef can't get stuck and keep redrawing on the next move.
    const stopDraw = () => {
      drawingRef.current = false
    }
    window.addEventListener('mouseup', stopDraw)
    window.addEventListener('touchend', stopDraw)
    window.addEventListener('touchcancel', stopDraw)

    loadModuleRef
      .current()
      .then((gl) => {
        if (cancelled || !containerRef.current) return

        const map = new gl.Map({
          container: containerRef.current,
          attributionControl: true,
          center: [0, 20],
          zoom: 1.4,
          ...mapOptionsRef.current
        })
        mapRef.current = map

        // If the map never reaches 'load' (e.g. the style fails to fetch), fall
        // back to the coordinate fields instead of showing "Loading map…"
        // forever.
        loadWatchdog = setTimeout(() => {
          if (!cancelled) onUnavailableRef.current()
        }, MAP_LOAD_TIMEOUT_MS)

        const onDown = (event: MapPointerEvent) => {
          if (!drawModeRef.current || !event.lngLat) return
          event.preventDefault?.()
          drawingRef.current = true
          didDrawRef.current = true
          const point = { lat: event.lngLat.lat, lng: event.lngLat.lng }
          startRef.current = point
          onChangeRef.current(boxFromPoints(point, point))
        }
        const onMove = (event: MapPointerEvent) => {
          if (!drawingRef.current || !startRef.current || !event.lngLat) return
          onChangeRef.current(
            boxFromPoints(startRef.current, {
              lat: event.lngLat.lat,
              lng: event.lngLat.lng
            })
          )
        }
        const onUp = () => {
          drawingRef.current = false
        }

        map.on('load', () => {
          if (cancelled) return
          if (loadWatchdog) clearTimeout(loadWatchdog)
          try {
            map.resize()
            map.addSource(BOX_SOURCE_ID, {
              type: 'geojson',
              data: boxToPolygon(boxRef.current)
            })
            map.addLayer({
              id: 'region-box-fill',
              type: 'fill',
              source: BOX_SOURCE_ID,
              paint: { 'fill-color': SELECTION_COLOR, 'fill-opacity': 0.15 }
            })
            map.addLayer({
              id: 'region-box-line',
              type: 'line',
              source: BOX_SOURCE_ID,
              paint: { 'line-color': SELECTION_COLOR, 'line-width': 2 }
            })

            map.on('mousedown', onDown)
            map.on('mousemove', onMove)
            map.on('mouseup', onUp)
            map.on('touchstart', onDown)
            map.on('touchmove', onMove)
            map.on('touchend', onUp)

            setIsReady(true)

            if (centerOnUserRef.current) {
              locateUser(map, true)
            } else {
              const current = boxRef.current
              map.fitBounds(
                [
                  [current.nw.lng, current.se.lat],
                  [current.se.lng, current.nw.lat]
                ],
                { padding: 40, duration: 0 }
              )
            }
          } catch {
            if (!cancelled) onUnavailableRef.current()
          }
        })
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current()
      })

    return () => {
      cancelled = true
      if (loadWatchdog) clearTimeout(loadWatchdog)
      window.removeEventListener('mouseup', stopDraw)
      window.removeEventListener('touchend', stopDraw)
      window.removeEventListener('touchcancel', stopDraw)
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Keep the drawn rectangle layer in sync with the box (drawn or typed).
  useEffect(() => {
    if (!isReady) return
    mapRef.current?.getSource(BOX_SOURCE_ID)?.setData(boxToPolygon(box))
  }, [box, isReady])

  // Draw mode disables panning so a drag draws the rectangle instead.
  useEffect(() => {
    drawModeRef.current = drawMode
    const map = mapRef.current
    if (!map || !isReady) return
    if (drawMode) {
      map.dragPan.disable()
      map.getCanvas().style.cursor = 'crosshair'
    } else {
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
    }
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
            {providerLabel}
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
