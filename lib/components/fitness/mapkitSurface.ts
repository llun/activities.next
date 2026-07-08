import { loadMapKitModule } from '@/lib/utils/mapkit'

/**
 * Structural view of the Apple MapKit JS surface the fitness map components
 * drive. MapKit is loaded from Apple's CDN at runtime (never bundled), so there
 * are no upstream types to import — this models only the members we call, the
 * same way the GL components model the Mapbox GL / MapLibre GL surface.
 */

/** Short provider name shown on the badge of every Apple-rendered map. */
export const APPLE_MAPS_LABEL = 'Apple Maps'

/**
 * Fall back to the manual/static surface if MapKit never becomes usable, instead
 * of spinning the "Loading map…" overlay forever. Mirrors the GL components.
 */
export const MAPKIT_LOAD_TIMEOUT_MS = 20_000

/** Minimum rendered span (degrees) so a single-point route still frames sanely. */
const MIN_REGION_SPAN_DEG = 0.01
/** Framing headroom around the fitted extent (MapKit has no `fitBounds` padding). */
const REGION_PADDING_FACTOR = 1.2

export interface MapKitCoordinate {
  latitude: number
  longitude: number
}

export interface MapKitCoordinateSpan {
  latitudeDelta: number
  longitudeDelta: number
}

export interface MapKitCoordinateRegion {
  center: MapKitCoordinate
  span: MapKitCoordinateSpan
}

// Opaque handles: we only ever hold these to add/remove them from a map.
export type MapKitStyle = object
export type MapKitOverlay = object
export type MapKitAnnotation = object

/** MapKit's map-level tap events carry the tapped point in page coordinates. */
export interface MapKitTapEvent {
  pointOnPage?: { x: number; y: number }
}

export interface MapKitMapSurface {
  /** The map's own DOM element — MapKit exposes no mouse/pointer map events. */
  element: HTMLElement
  region: MapKitCoordinateRegion
  isScrollEnabled: boolean
  isZoomEnabled: boolean
  isRotationEnabled: boolean
  addOverlay: (overlay: MapKitOverlay) => void
  addOverlays: (overlays: MapKitOverlay[]) => void
  removeOverlay: (overlay: MapKitOverlay) => void
  addAnnotation: (annotation: MapKitAnnotation) => void
  removeAnnotation: (annotation: MapKitAnnotation) => void
  addEventListener: (
    type: string,
    listener: (event: MapKitTapEvent) => void
  ) => void
  removeEventListener: (
    type: string,
    listener: (event: MapKitTapEvent) => void
  ) => void
  setRegionAnimated: (region: MapKitCoordinateRegion, animate?: boolean) => void
  convertPointOnPageToCoordinate: (point: DOMPoint) => MapKitCoordinate
  destroy: () => void
}

export interface MapKitSurfaceModule {
  Map: new (
    element: HTMLElement | string,
    options?: Record<string, unknown>
  ) => MapKitMapSurface
  Style: new (options?: Record<string, unknown>) => MapKitStyle
  PolylineOverlay: new (
    points: MapKitCoordinate[],
    options?: Record<string, unknown>
  ) => MapKitOverlay
  PolygonOverlay: new (
    points: MapKitCoordinate[],
    options?: Record<string, unknown>
  ) => MapKitOverlay
  CircleOverlay: new (
    coordinate: MapKitCoordinate,
    radius: number,
    options?: Record<string, unknown>
  ) => MapKitOverlay
  MarkerAnnotation: new (
    coordinate: MapKitCoordinate,
    options?: Record<string, unknown>
  ) => MapKitAnnotation
  Coordinate: new (latitude: number, longitude: number) => MapKitCoordinate
  CoordinateSpan: new (
    latitudeDelta: number,
    longitudeDelta?: number
  ) => MapKitCoordinateSpan
  CoordinateRegion: new (
    center: MapKitCoordinate,
    span: MapKitCoordinateSpan
  ) => MapKitCoordinateRegion
}

/** Typed wrapper around the shared CDN loader. */
export const loadMapKitSurface = (): Promise<MapKitSurfaceModule> =>
  loadMapKitModule<MapKitSurfaceModule>()

export interface MapKitLatLngBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/** MapKit frames a map by assigning a region, not by fitting a bounding box. */
export const boundsToRegion = (
  mapkit: MapKitSurfaceModule,
  bounds: MapKitLatLngBounds
): MapKitCoordinateRegion =>
  new mapkit.CoordinateRegion(
    new mapkit.Coordinate(
      (bounds.minLat + bounds.maxLat) / 2,
      (bounds.minLng + bounds.maxLng) / 2
    ),
    new mapkit.CoordinateSpan(
      Math.max(
        (bounds.maxLat - bounds.minLat) * REGION_PADDING_FACTOR,
        MIN_REGION_SPAN_DEG
      ),
      Math.max(
        (bounds.maxLng - bounds.minLng) * REGION_PADDING_FACTOR,
        MIN_REGION_SPAN_DEG
      )
    )
  )

/**
 * Translate a page-space point (a DOM pointer event) into a map coordinate.
 * MapKit exposes no map-level pointer events, so drawing interactions listen on
 * `map.element` and convert here. Returns null when MapKit rejects the point.
 */
export const pageToCoordinate = (
  map: MapKitMapSurface,
  pageX: number,
  pageY: number
): MapKitCoordinate | null => {
  if (typeof DOMPoint === 'undefined') return null
  try {
    return map.convertPointOnPageToCoordinate(new DOMPoint(pageX, pageY))
  } catch {
    return null
  }
}
