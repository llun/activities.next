import type {
  MapKitAnnotation,
  MapKitCoordinate,
  MapKitCoordinateRegion,
  MapKitCoordinateSpan,
  MapKitMapSurface,
  MapKitOverlay,
  MapKitSurfaceModule,
  MapKitTapEvent
} from '@/lib/components/fitness/mapkitSurface'

/**
 * An in-memory stand-in for the Apple MapKit JS module.
 *
 * The MapKit components only ever run their interesting code — overlay building,
 * annotation updates, gesture locking, teardown — *after* `loadMapKitModule`
 * resolves. Stubbing the loader with a never-resolving promise (the original test
 * shape) therefore exercises nothing but the loading spinner. Resolving it with
 * this double lets the component tests assert on the real post-load behaviour.
 *
 * It is deliberately spy-library agnostic: every interaction is recorded on plain
 * arrays/counters so the double can live outside a `*.test.ts` file.
 */

type ConstructorOptions = Record<string, unknown>

export type OverlayKind = 'polyline' | 'polygon' | 'circle'

export class TestStyle {
  constructor(readonly options: ConstructorOptions = {}) {}
}

const readStyleOptions = (
  options: ConstructorOptions | undefined
): ConstructorOptions | null => {
  const style = options?.style
  return style instanceof TestStyle ? style.options : null
}

export class TestOverlay {
  constructor(
    readonly kind: OverlayKind,
    readonly points: MapKitCoordinate[],
    readonly radiusMeters: number | null,
    readonly styleOptions: ConstructorOptions | null
  ) {}
}

export class TestAnnotation {
  constructor(
    readonly coordinate: MapKitCoordinate,
    readonly options: ConstructorOptions
  ) {}
}

type TapListener = (event: MapKitTapEvent) => void

export class TestMap implements MapKitMapSurface {
  readonly element: HTMLElement
  isScrollEnabled = true
  isZoomEnabled = true
  isRotationEnabled = true

  /** Overlays currently attached to the map. */
  readonly currentOverlays: MapKitOverlay[] = []
  /** Every overlay ever removed, in removal order. */
  readonly removedOverlays: MapKitOverlay[] = []
  readonly currentAnnotations: MapKitAnnotation[] = []
  readonly removedAnnotations: MapKitAnnotation[] = []
  /** Regions assigned through `map.region = …`. */
  readonly assignedRegions: MapKitCoordinateRegion[] = []
  readonly animatedRegions: MapKitCoordinateRegion[] = []
  destroyCount = 0

  private readonly listeners = new Map<string, TapListener[]>()
  private currentRegion: MapKitCoordinateRegion

  constructor(
    container: HTMLElement | string,
    readonly options: ConstructorOptions = {}
  ) {
    this.element =
      typeof container === 'string'
        ? document.createElement('div')
        : container.appendChild(document.createElement('div'))
    this.currentRegion = (options.region as MapKitCoordinateRegion) ?? {
      center: { latitude: 0, longitude: 0 },
      span: { latitudeDelta: 1, longitudeDelta: 1 }
    }
  }

  get region() {
    return this.currentRegion
  }

  set region(region: MapKitCoordinateRegion) {
    this.currentRegion = region
    this.assignedRegions.push(region)
  }

  addOverlay(overlay: MapKitOverlay) {
    this.currentOverlays.push(overlay)
  }

  addOverlays(overlays: MapKitOverlay[]) {
    this.currentOverlays.push(...overlays)
  }

  removeOverlay(overlay: MapKitOverlay) {
    const index = this.currentOverlays.indexOf(overlay)
    if (index >= 0) this.currentOverlays.splice(index, 1)
    this.removedOverlays.push(overlay)
  }

  removeOverlays(overlays: MapKitOverlay[]) {
    for (const overlay of overlays) this.removeOverlay(overlay)
  }

  addAnnotation(annotation: MapKitAnnotation) {
    this.currentAnnotations.push(annotation)
  }

  removeAnnotation(annotation: MapKitAnnotation) {
    const index = this.currentAnnotations.indexOf(annotation)
    if (index >= 0) this.currentAnnotations.splice(index, 1)
    this.removedAnnotations.push(annotation)
  }

  addEventListener(type: string, listener: TapListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: TapListener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener)
    )
  }

  /** Fire a MapKit map event (`single-tap`, …) at every registered listener. */
  emit(type: string, event: MapKitTapEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  listenerCount(type: string) {
    return (this.listeners.get(type) ?? []).length
  }

  setRegionAnimated(region: MapKitCoordinateRegion) {
    this.currentRegion = region
    this.animatedRegions.push(region)
  }

  /** Page space maps straight onto coordinate space: x → longitude, y → latitude. */
  convertPointOnPageToCoordinate(point: DOMPoint): MapKitCoordinate {
    return { latitude: point.y, longitude: point.x }
  }

  destroy() {
    this.destroyCount += 1
  }
}

export interface MapKitTestDouble {
  mapkit: MapKitSurfaceModule
  /** Every map ever constructed, in construction order. */
  maps: TestMap[]
  /** Every overlay ever constructed, in construction order. */
  overlays: TestOverlay[]
  /** Every annotation ever constructed, in construction order. */
  annotations: TestAnnotation[]
  /** The most recently constructed map, or null before the component built one. */
  getMap: () => TestMap | null
  overlaysOfKind: (kind: OverlayKind) => TestOverlay[]
}

/** jsdom ships no `DOMPoint`, which `pageToCoordinate` requires to convert taps. */
export const ensureDomPoint = () => {
  if (typeof globalThis.DOMPoint !== 'undefined') return
  class TestDomPoint {
    constructor(
      readonly x = 0,
      readonly y = 0,
      readonly z = 0,
      readonly w = 1
    ) {}
  }
  Object.assign(globalThis, { DOMPoint: TestDomPoint })
}

export const createMapKitTestDouble = (): MapKitTestDouble => {
  const maps: TestMap[] = []
  const overlays: TestOverlay[] = []
  const annotations: TestAnnotation[] = []

  const trackOverlay = (overlay: TestOverlay) => {
    overlays.push(overlay)
    return overlay
  }

  const mapkit = {
    Map: function Map(container: HTMLElement | string, options = {}) {
      const map = new TestMap(container, options)
      maps.push(map)
      return map
    } as unknown as MapKitSurfaceModule['Map'],
    Style: function Style(options = {}) {
      return new TestStyle(options)
    } as unknown as MapKitSurfaceModule['Style'],
    PolylineOverlay: function PolylineOverlay(
      points: MapKitCoordinate[],
      options?: ConstructorOptions
    ) {
      return trackOverlay(
        new TestOverlay('polyline', points, null, readStyleOptions(options))
      )
    } as unknown as MapKitSurfaceModule['PolylineOverlay'],
    PolygonOverlay: function PolygonOverlay(
      points: MapKitCoordinate[],
      options?: ConstructorOptions
    ) {
      return trackOverlay(
        new TestOverlay('polygon', points, null, readStyleOptions(options))
      )
    } as unknown as MapKitSurfaceModule['PolygonOverlay'],
    CircleOverlay: function CircleOverlay(
      coordinate: MapKitCoordinate,
      radius: number,
      options?: ConstructorOptions
    ) {
      return trackOverlay(
        new TestOverlay(
          'circle',
          [coordinate],
          radius,
          readStyleOptions(options)
        )
      )
    } as unknown as MapKitSurfaceModule['CircleOverlay'],
    MarkerAnnotation: function MarkerAnnotation(
      coordinate: MapKitCoordinate,
      options: ConstructorOptions = {}
    ) {
      const annotation = new TestAnnotation(coordinate, options)
      annotations.push(annotation)
      return annotation
    } as unknown as MapKitSurfaceModule['MarkerAnnotation'],
    Coordinate: function Coordinate(latitude: number, longitude: number) {
      return { latitude, longitude }
    } as unknown as MapKitSurfaceModule['Coordinate'],
    CoordinateSpan: function CoordinateSpan(
      latitudeDelta: number,
      longitudeDelta = latitudeDelta
    ) {
      return { latitudeDelta, longitudeDelta }
    } as unknown as MapKitSurfaceModule['CoordinateSpan'],
    CoordinateRegion: function CoordinateRegion(
      center: MapKitCoordinate,
      span: MapKitCoordinateSpan
    ) {
      return { center, span }
    } as unknown as MapKitSurfaceModule['CoordinateRegion']
  } satisfies MapKitSurfaceModule

  ensureDomPoint()

  return {
    mapkit,
    maps,
    overlays,
    annotations,
    getMap: () => maps[maps.length - 1] ?? null,
    overlaysOfKind: (kind) =>
      overlays.filter((overlay) => overlay.kind === kind)
  }
}
