'use client'

import { Crosshair, LocateFixed } from 'lucide-react'
import { CSSProperties, FC, useEffect, useRef, useState } from 'react'

import {
  Box,
  boxFromPoints,
  boxToPolygon
} from '@/lib/components/fitness/mapGeometry'
import { MapLoadingOverlay } from '@/lib/components/map/MapLoadingOverlay'
import { Button } from '@/lib/components/ui/button'
import { LatLng } from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'

// The Mapbox GL / MapLibre GL surface — only the members this component drives.
// The two libraries share this subset, so one component drives either provider.
// Pointer events carry a `lngLat`; the `load` event does not, so it is optional.
// `originalEvent.touches` lets us ignore multi-touch (pinch) gestures.
type MapPointerEvent = {
  lngLat?: { lat: number; lng: number }
  originalEvent?: { touches?: { length: number } }
  preventDefault?: () => void
}

const isMultiTouch = (event: MapPointerEvent): boolean =>
  (event.originalEvent?.touches?.length ?? 0) > 1

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
  addControl: (control: unknown) => void
}

export type GlModule = {
  Map: new (options: Record<string, unknown>) => GlMap
  AttributionControl: new (options: {
    compact: boolean
    customAttribution?: string
  }) => unknown
}

const BOX_SOURCE_ID = 'region-box'
// What the credit's lift (below) is derived from: the hint pill's `bottom-2`
// inset, the 10px margin the GL attribution control brings of its own, and the
// 12px the design draws between the credit and the hint. A one-line hint
// measures 24.5px; the first paint assumes it, before the hint exists to be
// measured.
const HINT_BOTTOM_INSET = 8
const CONTROL_MARGIN = 10
const CREDIT_HINT_GAP = 12
const ONE_LINE_HINT_HEIGHT = 25
const MAPLIBRE_CREDIT_SELECTOR = '.maplibregl-ctrl-attrib'
const SELECTION_COLOR = '#ea580c'
// Fall back to the coordinate fields if the map never finishes loading.
const MAP_LOAD_TIMEOUT_MS = 20000

interface RegionMapProps {
  box: Box
  onChange: (box: Box) => void
  /** Loads the GL module (Mapbox GL or MapLibre GL). */
  loadModule: () => Promise<GlModule>
  /** GL Map constructor options minus `container` (style, accessToken, …). */
  mapOptions: Record<string, unknown>
  /** Short provider name shown on the map badge (e.g. "Mapbox"). */
  providerLabel: string
  /**
   * The GL library's own credit (HTML), shown ahead of the style's. MapLibre's
   * default attribution control adds one; the control built here by hand does
   * not, so a MapLibre caller passes it. Mapbox has none.
   */
  customAttribution?: string
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
  customAttribution,
  centerOnUser,
  onUnavailable,
  height = 260
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hintRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GlMap | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [hintHeight, setHintHeight] = useState(ONE_LINE_HINT_HEIGHT)

  // Latest values read inside long-lived GL event handlers / the mount-once
  // create effect without re-subscribing or recreating the map every render.
  const boxRef = useRef(box)
  const onChangeRef = useRef(onChange)
  const onUnavailableRef = useRef(onUnavailable)
  const loadModuleRef = useRef(loadModule)
  const mapOptionsRef = useRef(mapOptions)
  const customAttributionRef = useRef(customAttribution)
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
    customAttributionRef.current = customAttribution
    centerOnUserRef.current = centerOnUser
  }, [loadModule, mapOptions, customAttribution, centerOnUser])

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

    // MapLibre's compact control opens itself for the first view and folds on
    // the first drag (`maplibregl-compact-show`). Drop that state, so the credit
    // is the "i" button and opens on a tap — which is what the control's own
    // click handler does from the folded state. Mapbox's compact control starts
    // folded and has nothing to undo.
    const foldMaplibreCredit = () =>
      containerRef.current
        ?.querySelector(MAPLIBRE_CREDIT_SELECTOR)
        ?.classList.remove('maplibregl-compact-show')

    loadModuleRef
      .current()
      .then((gl) => {
        if (cancelled || !containerRef.current) return

        const map = new gl.Map({
          container: containerRef.current,
          // The control is added below instead: Mapbox's Map option is only a
          // boolean, and its default control folds by the map's width alone.
          attributionControl: false,
          center: [0, 20],
          zoom: 1.4,
          ...mapOptionsRef.current
        })
        mapRef.current = map
        // `compact` keeps the credit behind the "i" button at every width on
        // both libraries, with the credits their styles declare (OpenFreeMap /
        // OpenMapTiles / OpenStreetMap, or Mapbox's) and the library's own,
        // where the default control would have had one. The corner lift on the
        // map container (below) is what keeps it clear of the hint pill.
        map.addControl(
          new gl.AttributionControl({
            compact: true,
            customAttribution: customAttributionRef.current
          })
        )
        // Folded as soon as it exists, not only once the map loads: until then
        // the wide credit would sit over the "Loading map…" overlay. With
        // `customAttribution` MapLibre opens the control once, inside
        // `addControl`, so this is enough; a control created without it starts
        // empty and opens when the style's credits arrive, which is why the
        // fold runs on load as well.
        foldMaplibreCredit()

        // If the map never reaches 'load' (e.g. the style fails to fetch), fall
        // back to the coordinate fields instead of showing "Loading map…"
        // forever.
        loadWatchdog = setTimeout(() => {
          if (!cancelled) onUnavailableRef.current()
        }, MAP_LOAD_TIMEOUT_MS)

        const onDown = (event: MapPointerEvent) => {
          // Ignore multi-touch (pinch-zoom) so it doesn't start a stray draw.
          if (!drawModeRef.current || !event.lngLat || isMultiTouch(event))
            return
          event.preventDefault?.()
          drawingRef.current = true
          didDrawRef.current = true
          const point = { lat: event.lngLat.lat, lng: event.lngLat.lng }
          startRef.current = point
          onChangeRef.current(boxFromPoints(point, point))
        }
        const onMove = (event: MapPointerEvent) => {
          if (
            !drawingRef.current ||
            !startRef.current ||
            !event.lngLat ||
            isMultiTouch(event)
          )
            return
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
            foldMaplibreCredit()
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

            // Always frame the current box first so it's visible even if
            // geolocation is denied/unavailable (otherwise a new area would sit
            // off-screen at world zoom). A successful locate then eases to the
            // user's position.
            const current = boxRef.current
            map.fitBounds(
              [
                [current.nw.lng, current.se.lat],
                [current.se.lng, current.nw.lat]
              ],
              { padding: 40, duration: 0 }
            )
            if (centerOnUserRef.current) {
              locateUser(map, true)
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

  // The hint wraps to a second line on a narrow map and its text changes with
  // draw mode, so its height is measured rather than assumed: the credit's lift
  // follows it (see the container below).
  useEffect(() => {
    const hint = hintRef.current
    if (!hint) return

    const measure = () => {
      const { height } = hint.getBoundingClientRect()
      if (height > 0) setHintHeight(height)
    }
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(hint)
    return () => observer.disconnect()
  }, [isReady])

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

  // Where the credit sits above the map's bottom edge: over the hint (its inset
  // and its measured height) and the gap the design draws, less the margin the
  // control already has of its own.
  const creditLift =
    HINT_BOTTOM_INSET + hintHeight + CREDIT_HINT_GAP - CONTROL_MARGIN

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={
        {
          height,
          '--region-credit-lift': `${creditLift}px`
        } as CSSProperties
      }
    >
      {/* The corner the attribution lives in is lifted by `--region-credit-lift`
          so the credit sits 12px above the hint pill — and the lift follows the
          hint, which wraps to a second line below ~390px, so it clears a
          two-line hint as well as a one-line one. The `!` is needed: the GL
          stylesheet is injected unlayered, which beats every Tailwind utility
          (they live in `@layer utilities`) whatever the specificity. */}
      <div
        ref={containerRef}
        className="h-full w-full [&_.maplibregl-ctrl-bottom-right]:bottom-(--region-credit-lift)! [&_.mapboxgl-ctrl-bottom-right]:bottom-(--region-credit-lift)!"
      />

      {!isReady && <MapLoadingOverlay />}

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
            ref={hintRef}
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
