import { Play, Plus } from 'lucide-react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'

import type { FitnessRouteSample, FitnessRouteSegment } from '@/lib/client'
import { ActivityRouteMapKit } from '@/lib/components/fitness/ActivityRouteMapKit'
import {
  ROUTE_PRIVACY_HINT_TAP_TIMEOUT_MS,
  RoutePrivacyDescription,
  RoutePrivacyHint,
  type RoutePrivacyHintPoint,
  isHoverCapablePointer
} from '@/lib/components/fitness/RoutePrivacyHint'
import { findRouteSampleForElapsed } from '@/lib/components/fitness/mapGeometry'
import {
  ROUTE_HIGHLIGHT_CORE_COLOR,
  ROUTE_HIGHLIGHT_CORE_RADIUS_PX,
  ROUTE_HIGHLIGHT_HALO_COLOR,
  ROUTE_HIGHLIGHT_HALO_OPACITY,
  ROUTE_HIGHLIGHT_HALO_RADIUS_PX,
  ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR
} from '@/lib/components/fitness/routeHighlightMarker'
import { Media } from '@/lib/components/posts/media'
import type { Attachment } from '@/lib/types/domain/attachment'
import {
  type PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'

interface MapPointGeometry {
  type: 'Point'
  coordinates: [number, number]
}

interface MapLineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

interface RouteLineProperties {
  isHiddenByPrivacy: boolean
}

interface MapFeature<TGeometry, TProperties = Record<string, unknown>> {
  type: 'Feature'
  properties: TProperties
  geometry: TGeometry
}

interface MapFeatureCollection<
  TGeometry,
  TProperties = Record<string, unknown>
> {
  type: 'FeatureCollection'
  features: Array<MapFeature<TGeometry, TProperties>>
}

type MapGeoJSONFeatureCollection =
  | MapFeatureCollection<MapPointGeometry>
  | MapFeatureCollection<MapLineStringGeometry, RouteLineProperties>

interface MapboxGeoJSONSource {
  setData: (data: MapGeoJSONFeatureCollection) => void
}

interface MapboxLngLatBounds {
  extend: (lngLat: [number, number]) => MapboxLngLatBounds
}

/**
 * What a layer-scoped `mousemove`/`click` handler receives. Only `point` is
 * modelled: it is the canvas-relative pixel position, which is all the privacy
 * hint needs to anchor itself. `features` is deliberately absent — both engines
 * attach it to the shared map-level event and `delete` it the instant the
 * listener returns, so it is a trap to hold on to, and a layer-scoped handler
 * only fires when the pointer really is over that layer anyway.
 */
interface MapboxLayerMouseEvent {
  point: { x: number; y: number }
}

interface MapboxMap {
  addSource: (id: string, source: Record<string, unknown>) => void
  addLayer: (layer: Record<string, unknown>) => void
  once: (event: 'load', listener: () => void) => void
  /**
   * Layer-scoped pointer events. Registration is silently dropped if the layer
   * does not exist yet, so every `on` must come after its `addLayer`.
   */
  on: (
    event: 'mousemove' | 'mouseleave' | 'click',
    layerId: string,
    listener: (event: MapboxLayerMouseEvent) => void
  ) => void
  getCanvas: () => HTMLCanvasElement
  getSource: (id: string) => unknown
  getZoom: () => number
  fitBounds: (
    bounds: MapboxLngLatBounds,
    options: { padding: number; maxZoom: number; duration: number }
  ) => void
  setMinZoom: (zoom: number) => void
  setMaxBounds: (bounds: MapboxLngLatBounds) => void
  zoomIn: (options?: { duration?: number }) => void
  zoomOut: (options?: { duration?: number }) => void
  remove: () => void
}

// The Mapbox GL / MapLibre GL surface this panel drives — both libraries expose
// the same `Map` + `LngLatBounds` constructors, so one code path renders either.
interface MapboxModule {
  Map: new (options: Record<string, unknown>) => MapboxMap
  LngLatBounds: new (
    sw: [number, number],
    ne: [number, number]
  ) => MapboxLngLatBounds
}

export const MAP_ROUTE_SOURCE_ID = 'activity-route'
export const MAP_ROUTE_HIDDEN_HIT_LAYER_ID = 'activity-route-line-hidden-hit'
export const MAP_ACTIVE_POINT_SOURCE_ID = 'activity-active-point'
// The interactive map now renders for every provider, so a style/tile failure
// (CDN outage, blocked origin, offline) must still surface the pre-generated
// static preview. `loadModule()` has its own 15s timeout, but once the GL module
// is in memory a failing style simply never fires `load` — hence the watchdog,
// matching RouteHeatmapMap.
export const MAP_LOAD_TIMEOUT_MS = 20_000

const normalizeRouteSample = (
  sample: FitnessRouteSample
): FitnessRouteSample => {
  return {
    ...sample,
    isHiddenByPrivacy: Boolean(sample.isHiddenByPrivacy)
  }
}

const normalizeRouteSegments = ({
  samples,
  segments
}: {
  samples: FitnessRouteSample[]
  segments?: FitnessRouteSegment[]
}): FitnessRouteSegment[] => {
  if (Array.isArray(segments)) {
    const normalizedSegments = segments
      .map((segment) => ({
        isHiddenByPrivacy: Boolean(segment.isHiddenByPrivacy),
        samples: Array.isArray(segment.samples)
          ? segment.samples.map((sample) => normalizeRouteSample(sample))
          : []
      }))
      .filter((segment) => segment.samples.length > 0)

    if (normalizedSegments.length > 0) {
      return normalizedSegments
    }
  }

  if (samples.length >= 2) {
    return [
      {
        isHiddenByPrivacy: false,
        samples: samples.map((sample) => normalizeRouteSample(sample))
      }
    ]
  }

  return []
}

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max)
}

const clampLongitude = (value: number) => {
  return clampNumber(value, -180, 180)
}

const clampLatitude = (value: number) => {
  return clampNumber(value, -85, 85)
}

const getRouteBoundsCoordinates = (samples: FitnessRouteSample[]) => {
  const initial = samples[0]
  let west = initial.lng
  let east = initial.lng
  let south = initial.lat
  let north = initial.lat

  for (let index = 1; index < samples.length; index += 1) {
    west = Math.min(west, samples[index].lng)
    east = Math.max(east, samples[index].lng)
    south = Math.min(south, samples[index].lat)
    north = Math.max(north, samples[index].lat)
  }

  return {
    west,
    east,
    south,
    north
  }
}

export interface ActivityMapPanelProps {
  mapAttachment?: Attachment
  routeSamples?: FitnessRouteSample[]
  routeSegments?: FitnessRouteSegment[]
  highlightedElapsedSeconds?: number | null
  mapProvider: PublicMapProvider
  routeDataError?: string | null
  isRouteDataLoading?: boolean
  onOpenMap?: () => void
}

const EMPTY_ROUTE_SAMPLES: FitnessRouteSample[] = []
const EMPTY_ROUTE_SEGMENTS: FitnessRouteSegment[] = []

export const ActivityMapPanel: FC<ActivityMapPanelProps> = ({
  mapAttachment,
  routeSamples = EMPTY_ROUTE_SAMPLES,
  routeSegments = EMPTY_ROUTE_SEGMENTS,
  highlightedElapsedSeconds = null,
  mapProvider,
  routeDataError = null,
  isRouteDataLoading = false,
  onOpenMap
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)
  // Anchor for the "hidden from other viewers" hint, set while the pointer is
  // over a green segment. The GL engines hit-test their own layers, so this is
  // just the pixel they report; the Apple renderer does the same thing
  // geometrically inside ActivityRouteMapKit.
  const [privacyHintPoint, setPrivacyHintPoint] =
    useState<RoutePrivacyHintPoint | null>(null)
  // A tap has no pointer-leave to close the hint, so it retires on a timer.
  const privacyHintTimeoutRef = useRef<number | undefined>(undefined)

  const normalizedRouteSamples = useMemo(
    () => (routeSamples ?? []).map(normalizeRouteSample),
    [routeSamples]
  )

  const normalizedRouteSegments = useMemo(
    () =>
      normalizeRouteSegments({
        samples: normalizedRouteSamples,
        segments: routeSegments
      }),
    [normalizedRouteSamples, routeSegments]
  )

  const drawableRouteSegments = useMemo(
    () =>
      normalizedRouteSegments.filter((segment) => segment.samples.length >= 2),
    [normalizedRouteSegments]
  )
  const routeSamplesForBounds = useMemo(
    () => drawableRouteSegments.flatMap((segment) => segment.samples),
    [drawableRouteSegments]
  )
  const hasHiddenPrivacySegments = useMemo(
    () => drawableRouteSegments.some((segment) => segment.isHiddenByPrivacy),
    [drawableRouteSegments]
  )

  // Keyed on the descriptor's fields (not its object identity) so an inline prop
  // literal doesn't tear the map down on every parent render. Apple renders
  // through MapKit JS, not a GL engine, so it has no GL provider descriptor.
  const providerType = mapProvider.type
  const providerAccessToken =
    mapProvider.type === 'mapbox' ? mapProvider.accessToken : undefined
  const glProvider = useMemo(
    () =>
      mapProvider.type === 'apple'
        ? null
        : buildGlProviderOptions(mapProvider, 'outdoors'),
    [providerType, providerAccessToken]
  )

  // Every provider now renders a real, interactive map — the pre-generated
  // static image stays as the fallback for a map that fails to load.
  const shouldRenderInteractiveMap =
    drawableRouteSegments.length > 0 && !routeDataError && !mapLoadError

  const routeFeatureCollection = useMemo(
    (): MapFeatureCollection<MapLineStringGeometry, RouteLineProperties> => ({
      type: 'FeatureCollection',
      features: drawableRouteSegments.map((segment) => ({
        type: 'Feature',
        properties: {
          isHiddenByPrivacy: segment.isHiddenByPrivacy
        },
        geometry: {
          type: 'LineString',
          coordinates: segment.samples.map((sample) => [sample.lng, sample.lat])
        }
      }))
    }),
    [drawableRouteSegments]
  )

  const activeSample = useMemo(() => {
    if (!shouldRenderInteractiveMap) return null
    if (typeof highlightedElapsedSeconds !== 'number') return null
    return findRouteSampleForElapsed(
      normalizedRouteSamples,
      highlightedElapsedSeconds
    )
  }, [
    highlightedElapsedSeconds,
    normalizedRouteSamples,
    shouldRenderInteractiveMap
  ])

  useEffect(() => {
    if (
      !glProvider ||
      !shouldRenderInteractiveMap ||
      !mapContainerRef.current
    ) {
      mapRef.current?.remove()
      mapRef.current = null
      return
    }

    let cancelled = false
    let loadWatchdog: number | undefined

    const clearLoadWatchdog = () => {
      if (loadWatchdog === undefined) return
      window.clearTimeout(loadWatchdog)
      loadWatchdog = undefined
    }

    const failToStaticPreview = () => {
      if (cancelled) return
      clearLoadWatchdog()
      mapRef.current?.remove()
      mapRef.current = null
      setMapLoadError('Interactive map unavailable. Using static preview.')
    }

    const initializeMap = async () => {
      try {
        const mapbox = (await glProvider.loadModule()) as MapboxModule
        if (cancelled || !mapContainerRef.current) return

        setMapLoadError(null)

        const map = new mapbox.Map({
          container: mapContainerRef.current,
          attributionControl: false,
          // style (and, for Mapbox, accessToken) come from the resolved provider.
          ...glProvider.mapOptions
        })

        mapRef.current = map

        // A style/tile failure never fires `load`; fall back rather than leave an
        // empty container behind. Deliberately watchdog-only, matching
        // RouteHeatmapMap: GL's `error` event is not a fatal-only channel (it also
        // fires for a single missing tile, a failed sprite/glyph fetch, or a
        // request aborted while panning), so treating it as fatal would tear down
        // a working, fully rendered map.
        loadWatchdog = window.setTimeout(
          failToStaticPreview,
          MAP_LOAD_TIMEOUT_MS
        )

        map.once('load', () => {
          clearLoadWatchdog()
          if (cancelled || !mapRef.current) return

          map.addSource(MAP_ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: routeFeatureCollection
          })

          map.addLayer({
            id: 'activity-route-line-visible',
            type: 'line',
            source: MAP_ROUTE_SOURCE_ID,
            filter: ['==', ['get', 'isHiddenByPrivacy'], false],
            paint: {
              'line-color': '#f97316',
              'line-width': 4,
              'line-opacity': 0.9
            }
          })

          map.addLayer({
            id: 'activity-route-line-hidden',
            type: 'line',
            source: MAP_ROUTE_SOURCE_ID,
            filter: ['==', ['get', 'isHiddenByPrivacy'], true],
            paint: {
              'line-color': '#16a34a',
              'line-width': 4,
              'line-opacity': 0.95
            }
          })

          // Invisible, fat hit target for the privacy hint. A GL line's hit
          // test is its own `line-width/2` per side, so the 4px green line is a
          // ±2px target — unhittable in practice. Opacity is not consulted by
          // the hit test, so a zero-opacity 24px twin is hoverable while
          // drawing nothing. It must exist before any listener names it:
          // registration against a missing layer is dropped in silence.
          map.addLayer({
            id: MAP_ROUTE_HIDDEN_HIT_LAYER_ID,
            type: 'line',
            source: MAP_ROUTE_SOURCE_ID,
            filter: ['==', ['get', 'isHiddenByPrivacy'], true],
            paint: {
              'line-color': '#16a34a',
              'line-width': 24,
              'line-opacity': 0
            }
          })

          const showPrivacyHint = (event: MapboxLayerMouseEvent) => {
            window.clearTimeout(privacyHintTimeoutRef.current)
            privacyHintTimeoutRef.current = undefined
            setPrivacyHintPoint({ x: event.point.x, y: event.point.y })
          }

          map.on('mousemove', MAP_ROUTE_HIDDEN_HIT_LAYER_ID, (event) => {
            showPrivacyHint(event)
            map.getCanvas().style.cursor = 'help'
          })

          map.on('mouseleave', MAP_ROUTE_HIDDEN_HIT_LAYER_ID, () => {
            window.clearTimeout(privacyHintTimeoutRef.current)
            privacyHintTimeoutRef.current = undefined
            setPrivacyHintPoint(null)
            map.getCanvas().style.cursor = ''
          })

          // Touch: a tap fires `click` but never `mouseleave`, so the hint
          // closes itself. `click` fires for a mouse press too, though, and
          // arming the timer there would yank the hint away mid-hover — so
          // where hover exists, `mouseleave` is left to govern.
          map.on('click', MAP_ROUTE_HIDDEN_HIT_LAYER_ID, (event) => {
            setPrivacyHintPoint({ x: event.point.x, y: event.point.y })
            window.clearTimeout(privacyHintTimeoutRef.current)
            privacyHintTimeoutRef.current = undefined
            if (isHoverCapablePointer()) return
            privacyHintTimeoutRef.current = window.setTimeout(() => {
              setPrivacyHintPoint(null)
            }, ROUTE_PRIVACY_HINT_TAP_TIMEOUT_MS)
          })

          map.addSource(MAP_ACTIVE_POINT_SOURCE_ID, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            }
          })

          // Geometry and colours come from the shared highlight-marker module so
          // the Apple MapKit annotation draws the identical dot.
          map.addLayer({
            id: 'activity-active-point-ring',
            type: 'circle',
            source: MAP_ACTIVE_POINT_SOURCE_ID,
            paint: {
              'circle-radius': ROUTE_HIGHLIGHT_HALO_RADIUS_PX,
              'circle-color': ROUTE_HIGHLIGHT_HALO_COLOR,
              'circle-opacity': ROUTE_HIGHLIGHT_HALO_OPACITY
            }
          })

          map.addLayer({
            id: 'activity-active-point-core',
            type: 'circle',
            source: MAP_ACTIVE_POINT_SOURCE_ID,
            paint: {
              'circle-radius': ROUTE_HIGHLIGHT_CORE_RADIUS_PX,
              'circle-color': [
                'case',
                ['==', ['get', 'isHiddenByPrivacy'], true],
                ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR,
                ROUTE_HIGHLIGHT_CORE_COLOR
              ]
            }
          })

          const routeBoundsCoordinates = getRouteBoundsCoordinates(
            routeSamplesForBounds
          )
          const routeBounds = new mapbox.LngLatBounds(
            [routeBoundsCoordinates.west, routeBoundsCoordinates.south],
            [routeBoundsCoordinates.east, routeBoundsCoordinates.north]
          )

          map.fitBounds(routeBounds, {
            padding: 28,
            maxZoom: 16,
            duration: 0
          })

          // Keep full route visible as the widest zoom-out level.
          map.setMinZoom(map.getZoom())

          const lngSpan = Math.max(
            routeBoundsCoordinates.east - routeBoundsCoordinates.west,
            0.005
          )
          const latSpan = Math.max(
            routeBoundsCoordinates.north - routeBoundsCoordinates.south,
            0.005
          )
          const lngPadding = Math.max(lngSpan * 0.2, 0.002)
          const latPadding = Math.max(latSpan * 0.2, 0.002)

          // Limit panning to the route vicinity.
          map.setMaxBounds(
            new mapbox.LngLatBounds(
              [
                clampLongitude(routeBoundsCoordinates.west - lngPadding),
                clampLatitude(routeBoundsCoordinates.south - latPadding)
              ],
              [
                clampLongitude(routeBoundsCoordinates.east + lngPadding),
                clampLatitude(routeBoundsCoordinates.north + latPadding)
              ]
            )
          )
        })
      } catch (_error) {
        failToStaticPreview()
      }
    }

    void initializeMap()

    return () => {
      cancelled = true
      clearLoadWatchdog()
      mapRef.current?.remove()
      mapRef.current = null
      // `remove()` takes the map's listeners with it, but not React state: the
      // effect re-runs whenever the route changes, and a hint left standing
      // would point at geometry that no longer exists.
      window.clearTimeout(privacyHintTimeoutRef.current)
      privacyHintTimeoutRef.current = undefined
      setPrivacyHintPoint(null)
    }
  }, [
    glProvider,
    routeFeatureCollection,
    routeSamplesForBounds,
    shouldRenderInteractiveMap
  ])

  useEffect(() => {
    if (!shouldRenderInteractiveMap) return

    const map = mapRef.current
    if (!map) return

    const source = map.getSource(MAP_ACTIVE_POINT_SOURCE_ID) as
      MapboxGeoJSONSource | undefined
    if (!source) return

    if (!activeSample) {
      source.setData({
        type: 'FeatureCollection',
        features: []
      })
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            isHiddenByPrivacy: Boolean(activeSample.isHiddenByPrivacy)
          },
          geometry: {
            type: 'Point',
            coordinates: [activeSample.lng, activeSample.lat]
          }
        }
      ]
    })
  }, [activeSample, shouldRenderInteractiveMap])

  useEffect(() => {
    return () => {
      if (privacyHintTimeoutRef.current !== undefined) {
        window.clearTimeout(privacyHintTimeoutRef.current)
        privacyHintTimeoutRef.current = undefined
      }
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="relative h-72 overflow-hidden rounded-lg border bg-muted">
      {shouldRenderInteractiveMap && !glProvider ? (
        <ActivityRouteMapKit
          routeSegments={drawableRouteSegments}
          routeSamples={normalizedRouteSamples}
          highlightedElapsedSeconds={highlightedElapsedSeconds}
          onUnavailable={() =>
            setMapLoadError(
              'Interactive map unavailable. Using static preview.'
            )
          }
        />
      ) : shouldRenderInteractiveMap ? (
        <div
          ref={mapContainerRef}
          role="img"
          aria-label="Activity route map"
          className="h-full w-full"
        />
      ) : mapAttachment ? (
        <button
          type="button"
          onClick={onOpenMap}
          className="block h-full w-full cursor-pointer"
        >
          <Media
            attachment={mapAttachment}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Map preview unavailable
        </div>
      )}

      {shouldRenderInteractiveMap ? (
        <>
          {/* MapKit renders its own zoom controls (it has no zoomIn/zoomOut). */}
          {glProvider ? (
            <div className="absolute left-3 top-3 flex flex-col overflow-hidden rounded-md border bg-background/95 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  mapRef.current?.zoomIn({ duration: 250 })
                }}
                className="flex size-8 items-center justify-center text-foreground hover:bg-muted"
                aria-label="Zoom in map"
              >
                <Plus className="size-4" />
              </button>
              <div className="h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  mapRef.current?.zoomOut({ duration: 250 })
                }}
                className="flex size-8 items-center justify-center text-foreground hover:bg-muted"
                aria-label="Zoom out map"
              >
                <span className="text-base leading-none">-</span>
              </button>
            </div>
          ) : null}
          {/* The Apple renderer positions its own hint (it hit-tests the route
              geometrically); this one is for the GL branch. */}
          {glProvider ? (
            <RoutePrivacyHint
              point={privacyHintPoint}
              containerSize={
                mapContainerRef.current
                  ? {
                      width: mapContainerRef.current.clientWidth,
                      height: mapContainerRef.current.clientHeight
                    }
                  : null
              }
            />
          ) : null}
          <RoutePrivacyDescription
            hasHiddenSegments={hasHiddenPrivacySegments}
          />
        </>
      ) : onOpenMap && mapAttachment ? (
        <button
          type="button"
          onClick={onOpenMap}
          className="absolute bottom-3 right-3 inline-flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground shadow"
          aria-label="Open route map image"
        >
          <Play className="size-5" />
        </button>
      ) : null}

      {!shouldRenderInteractiveMap && isRouteDataLoading ? (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          Loading interactive route...
        </div>
      ) : null}

      {!shouldRenderInteractiveMap && (routeDataError || mapLoadError) ? (
        <div className="absolute inset-x-3 top-3 rounded-md border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          {routeDataError || mapLoadError}
        </div>
      ) : null}
    </div>
  )
}
