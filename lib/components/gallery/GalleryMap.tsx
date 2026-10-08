'use client'

import { Loader2, MapPin, X } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import { FitnessAlert } from '@/lib/components/fitness/FitnessAlert'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { GalleryMapKit } from '@/lib/components/gallery/GalleryMapKit'
import { GalleryPlacesList } from '@/lib/components/gallery/GalleryPlacesList'
import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import { createGalleryMarkerElement } from '@/lib/components/gallery/galleryMapMarker'
import { getPointBounds } from '@/lib/components/gallery/galleryPlaces'
import { Button } from '@/lib/components/ui/button'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'
import {
  type PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'

// The Mapbox GL / MapLibre GL surface this map drives. Both libraries share
// this subset, so one component renders either provider.
interface GlFeature {
  properties?: Record<string, unknown> | null
  geometry?: { coordinates?: unknown }
}

interface GlMarker {
  setLngLat: (lngLat: [number, number]) => GlMarker
  addTo: (map: GalleryGlMap) => GlMarker
  remove: () => void
}

interface GalleryGlMap {
  on: (event: string, callback: () => void) => void
  remove: () => void
  resize: () => void
  addSource: (id: string, source: unknown) => void
  addLayer: (layer: unknown) => void
  getSource: (id: string) =>
    | {
        setData: (data: unknown) => void
        // Mapbox takes a callback, MapLibre returns a promise.
        getClusterLeaves?: (
          clusterId: number,
          limit: number,
          offset: number,
          callback?: (error: unknown, features?: GlFeature[]) => void
        ) => Promise<GlFeature[]> | void
      }
    | undefined
  querySourceFeatures: (sourceId: string) => GlFeature[]
  isSourceLoaded: (sourceId: string) => boolean
  getZoom: () => number
  easeTo: (options: Record<string, unknown>) => void
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: Record<string, unknown>
  ) => void
}

interface GalleryGlModule {
  Map: new (options: Record<string, unknown>) => GalleryGlMap
  Marker: new (options: { element: HTMLElement }) => GlMarker
}

const SOURCE_ID = 'gallery-media-points'
const HIT_LAYER_ID = 'gallery-media-points-hit'
const CLUSTER_RADIUS_PX = 56
const CLUSTER_MAX_ZOOM = 16
const CLUSTER_ZOOM_STEP = 2
// Map zoom is fractional; treat a hair under the max as having reached it.
const ZOOM_EPSILON = 0.01
const FIT_PADDING_PX = 56
const MAX_GROUP_MEMBERS = 50
const FIT_MAX_ZOOM = 12
// Fall back to the "Map unavailable" message if the GL map never reaches 'load'
// (the style or tiles fail to fetch), instead of spinning forever. Mirrors
// RouteHeatmapMap.
const MAP_LOAD_TIMEOUT_MS = 20_000
const MAP_HEIGHT_CLASS = 'h-[420px] max-md:h-[360px]'

type FallbackReason = 'module-load-failed' | 'render-failed' | 'load-timeout'

const buildFeatureCollection = (points: readonly GalleryMapPoint[]) => ({
  type: 'FeatureCollection',
  features: points.map((point, index) => ({
    type: 'Feature',
    properties: { idx: index },
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude]
    }
  }))
})

const isLngLat = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number'

// The members of a cluster, newest first. Empty when the source cannot say.
const readClusterMembers = (
  map: GalleryGlMap,
  clusterId: number,
  count: number
): Promise<number[]> =>
  new Promise((resolve) => {
    const toIndexes = (features?: GlFeature[]) =>
      (features ?? [])
        .map((feature) => Number(feature.properties?.idx))
        .filter((index) => Number.isInteger(index))
        .sort((left, right) => left - right)
    try {
      const source = map.getSource(SOURCE_ID)
      const pending = source?.getClusterLeaves?.(
        clusterId,
        Math.min(count, MAX_GROUP_MEMBERS),
        0,
        (error, features) => resolve(error ? [] : toIndexes(features))
      )
      if (pending && typeof pending.then === 'function') {
        pending.then(
          (features) => resolve(toIndexes(features)),
          () => resolve([])
        )
      } else if (!source?.getClusterLeaves) {
        resolve([])
      }
    } catch {
      resolve([])
    }
  })

interface GalleryGlMapProps {
  points: GalleryMapPoint[]
  mapProvider: Exclude<PublicMapProvider, { type: 'apple' }>
  onPick: (mediaId: string) => void
  onPickGroup: (mediaIds: string[], total?: number) => void
  onUnavailable: (reason: FallbackReason) => void
}

const GalleryGlMapSurface: FC<GalleryGlMapProps> = ({
  points,
  mapProvider,
  onPick,
  onPickGroup,
  onUnavailable
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GalleryGlMap | null>(null)
  const clearMarkersRef = useRef<() => void>(() => {})
  // The points the source currently holds, so the data effect skips a no-op.
  const appliedPointsRef = useRef<GalleryMapPoint[] | null>(null)
  const pointsRef = useRef(points)
  const onPickRef = useRef(onPick)
  const onPickGroupRef = useRef(onPickGroup)
  const onUnavailableRef = useRef(onUnavailable)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    pointsRef.current = points
    onPickRef.current = onPick
    onPickGroupRef.current = onPickGroup
    onUnavailableRef.current = onUnavailable
  }, [points, onPick, onPickGroup, onUnavailable])

  // Keyed on the descriptor's fields, not its identity, so an inline prop
  // literal doesn't tear the map down on every parent render.
  const providerType = mapProvider.type
  const providerAccessToken =
    mapProvider.type === 'mapbox' ? mapProvider.accessToken : undefined
  const provider = useMemo(
    () => buildGlProviderOptions(mapProvider, 'outdoors'),
    [providerType, providerAccessToken]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let loadWatchdog: ReturnType<typeof setTimeout> | undefined
    let resizeObserver: ResizeObserver | undefined
    const markers = new Map<string, GlMarker>()
    setIsLoaded(false)

    const clearMarkers = () => {
      for (const marker of markers.values()) marker.remove()
      markers.clear()
    }
    clearMarkersRef.current = clearMarkers

    provider
      .loadModule()
      .then((loaded) => {
        const gl = loaded as GalleryGlModule
        if (cancelled || !containerRef.current) return

        const map = new gl.Map({
          container,
          attributionControl: true,
          center: [0, 20],
          zoom: 1.4,
          ...provider.mapOptions
        })
        mapRef.current = map

        // The GL libraries size the canvas from the container at construction
        // and only recompute on window resizes; observe the container itself.
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => mapRef.current?.resize())
          resizeObserver.observe(container)
        }

        loadWatchdog = setTimeout(() => {
          if (!cancelled) onUnavailableRef.current('load-timeout')
        }, MAP_LOAD_TIMEOUT_MS)

        // Thumbnails are DOM markers drawn for whatever the clustered source
        // currently exposes: a feature is either one photo (`idx`) or a cluster
        // (`point_count`, plus `rep`, the newest member's index).
        const renderMarkers = () => {
          if (!map.isSourceLoaded(SOURCE_ID)) return

          const current = pointsRef.current
          const visible = new Set<string>()
          for (const feature of map.querySourceFeatures(SOURCE_ID)) {
            const properties = feature.properties ?? {}
            const coordinates = feature.geometry?.coordinates
            if (!isLngLat(coordinates)) continue

            const isCluster = typeof properties.point_count === 'number'
            const index = Number(isCluster ? properties.rep : properties.idx)
            const point = current[index]
            if (!point) continue

            const key = isCluster
              ? `cluster-${String(properties.cluster_id)}-${String(properties.point_count)}`
              : `point-${point.mediaId}`
            if (visible.has(key)) continue
            visible.add(key)
            if (markers.has(key)) continue

            const count = isCluster ? Number(properties.point_count) : 1
            const element = createGalleryMarkerElement({
              thumbnailUrl: point.thumbnailUrl,
              count,
              label: isCluster
                ? `${count} photos and videos close together, zoom in`
                : point.subjectName
                  ? `${point.subjectName}, open details`
                  : 'Photo or video, open details',
              onClick: () => {
                if (!isCluster) {
                  onPickRef.current(point.mediaId)
                  return
                }
                const zoom = map.getZoom()
                // Past the clustering zoom a cluster is photos at one spot, and
                // zooming further would show nothing new: list its members.
                if (zoom >= CLUSTER_MAX_ZOOM - ZOOM_EPSILON) {
                  void readClusterMembers(
                    map,
                    Number(properties.cluster_id),
                    count
                  ).then((indexes) => {
                    const ids = indexes.flatMap((member) =>
                      current[member] ? [current[member].mediaId] : []
                    )
                    if (ids.length > 1) onPickGroupRef.current(ids, count)
                    else onPickRef.current(point.mediaId)
                  })
                  return
                }
                map.easeTo({
                  center: coordinates,
                  zoom: Math.min(zoom + CLUSTER_ZOOM_STEP, CLUSTER_MAX_ZOOM)
                })
              }
            })
            markers
              .set(key, new gl.Marker({ element }).setLngLat(coordinates))
              .get(key)
              ?.addTo(map)
          }

          for (const [key, marker] of markers) {
            if (!visible.has(key)) {
              marker.remove()
              markers.delete(key)
            }
          }
        }

        map.on('load', () => {
          if (cancelled) return
          if (loadWatchdog) clearTimeout(loadWatchdog)
          try {
            map.resize()
            appliedPointsRef.current = pointsRef.current
            map.addSource(SOURCE_ID, {
              type: 'geojson',
              data: buildFeatureCollection(pointsRef.current),
              cluster: true,
              clusterRadius: CLUSTER_RADIUS_PX,
              clusterMaxZoom: CLUSTER_MAX_ZOOM,
              // The newest photo of a cluster (the lowest index) is its cover.
              clusterProperties: { rep: ['min', ['get', 'idx']] }
            })
            // GL only loads a source's tiles while a layer uses it, and the
            // markers are DOM, so this invisible layer is what keeps the
            // clusters computed.
            map.addLayer({
              id: HIT_LAYER_ID,
              type: 'circle',
              source: SOURCE_ID,
              paint: { 'circle-radius': 1, 'circle-opacity': 0 }
            })
            map.on('render', renderMarkers)
            const bounds = getPointBounds(pointsRef.current)
            if (bounds) {
              map.fitBounds(
                [
                  [bounds.minLng, bounds.minLat],
                  [bounds.maxLng, bounds.maxLat]
                ],
                { padding: FIT_PADDING_PX, duration: 0, maxZoom: FIT_MAX_ZOOM }
              )
            }
            setIsLoaded(true)
          } catch {
            if (!cancelled) onUnavailableRef.current('render-failed')
          }
        })
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current('module-load-failed')
      })

    return () => {
      cancelled = true
      if (loadWatchdog) clearTimeout(loadWatchdog)
      resizeObserver?.disconnect()
      clearMarkers()
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [provider])

  // A new set of points (the subject filter, the public preview) replaces the
  // source's data and reframes the map.
  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map || appliedPointsRef.current === points) return
    appliedPointsRef.current = points
    clearMarkersRef.current()
    map.getSource(SOURCE_ID)?.setData(buildFeatureCollection(points))
    const bounds = getPointBounds(points)
    if (bounds) {
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat]
        ],
        { padding: FIT_PADDING_PX, duration: 0, maxZoom: FIT_MAX_ZOOM }
      )
    }
  }, [isLoaded, points])

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {!isLoaded && (
        <div
          role="status"
          className="bg-muted/60 text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm"
        >
          <Loader2 className="size-4 animate-spin" /> Loading map…
        </div>
      )}
      {isLoaded && (
        <div className="bg-background/90 text-muted-foreground pointer-events-none absolute top-3 left-3 rounded px-2 py-1 text-xs shadow-sm">
          {provider.label}
        </div>
      )}
    </>
  )
}

interface SelectionCardProps {
  point: GalleryMapPoint
  onClose: () => void
  onOpen?: (mediaId: string) => void
}

const describePoint = (point: GalleryMapPoint) =>
  [formatGalleryDate(point.takenAt), point.placeName]
    .filter(Boolean)
    .join(' · ')

// `bottom-9` keeps the card above the map's attribution line (Mapbox, OSM,
// MapLibre, Apple legal), which must stay visible.
const CARD_CLASS =
  'bg-background absolute right-3 bottom-9 left-3 rounded-lg border shadow-md sm:right-auto sm:max-w-sm'

const CloseButton: FC<{ label: string; onClose: () => void }> = ({
  label,
  onClose
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    aria-label={label}
    onClick={onClose}
  >
    <X aria-hidden="true" className="size-4" />
  </Button>
)

const SelectionCard: FC<SelectionCardProps> = ({ point, onClose, onOpen }) => {
  const meta = describePoint(point)
  return (
    <div
      role="group"
      aria-label="Selected photo"
      className={cn(CARD_CLASS, 'flex items-center gap-3 p-2')}
    >
      {point.thumbnailUrl ? (
        <img
          src={point.thumbnailUrl}
          alt=""
          className="size-14 shrink-0 rounded-md object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate font-medium">
          {point.subjectName ?? 'Photo or video'}
        </p>
        {meta ? (
          <p className="text-muted-foreground truncate text-xs">{meta}</p>
        ) : null}
        {onOpen ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => onOpen(point.mediaId)}
          >
            Open photo
          </Button>
        ) : null}
      </div>
      <CloseButton label="Close selected photo" onClose={onClose} />
    </div>
  )
}

interface SelectionListCardProps {
  points: GalleryMapPoint[]
  /** The cluster's full size, when it is larger than the members listed. */
  total?: number
  onClose: () => void
  onOpen?: (mediaId: string) => void
  onFocusPoint: (mediaId: string) => void
}

/**
 * A cluster that cannot be split (photos at one spot) lists its members, so
 * each one is reachable. A row opens the photo when the caller allows it, and
 * otherwise shows that photo's own card.
 */
const SelectionListCard: FC<SelectionListCardProps> = ({
  points,
  total,
  onClose,
  onOpen,
  onFocusPoint
}) => (
  <div
    role="group"
    aria-label="Selected photos"
    className={cn(CARD_CLASS, 'flex items-start gap-1 p-2')}
  >
    <div className="min-w-0 flex-1 text-sm">
      <p className="px-1 pb-1 font-medium">
        {Math.max(points.length, total ?? 0)} photos here
      </p>
      <ul className="max-h-48 overflow-y-auto">
        {points.map((point) => (
          <li key={point.mediaId}>
            <button
              type="button"
              className="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md p-1 text-left focus-visible:ring-2 focus-visible:outline-none"
              onClick={() =>
                onOpen ? onOpen(point.mediaId) : onFocusPoint(point.mediaId)
              }
            >
              {point.thumbnailUrl ? (
                <img
                  src={point.thumbnailUrl}
                  alt=""
                  className="size-10 shrink-0 rounded-md object-cover"
                />
              ) : null}
              <span className="min-w-0">
                <span className="block truncate">
                  {point.subjectName ?? 'Photo or video'}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {describePoint(point)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total !== undefined && total > points.length ? (
        <p className="text-muted-foreground px-1 pt-1 text-xs">
          +{total - points.length} more, see Places below
        </p>
      ) : null}
    </div>
    <CloseButton label="Close selected photos" onClose={onClose} />
  </div>
)

export interface GalleryMapProps {
  points: GalleryMapPoint[]
  /** Which map backend renders the map (Mapbox, keyless OSM, or Apple). */
  mapProvider: PublicMapProvider
  /**
   * The viewer asked to open a point's photo from its card. A marker tap only
   * shows the card; this is the card's "Open photo" action, so the caller
   * decides where the photo opens (and the action is absent without it).
   */
  onSelect?: (mediaId: string) => void
}

/**
 * The gallery's map: clustered thumbnails with count badges and, below it, an
 * accessible list of places and their counts. Apple renders through MapKit JS,
 * so it delegates to `GalleryMapKit`; Mapbox and OpenFreeMap share the GL
 * surface. Whatever the engine, the points are already projected by the server
 * (a public viewer only ever gets `area` and `exact` ones), so nothing here
 * decides what is disclosed.
 */
export const GalleryMap: FC<GalleryMapProps> = ({
  points,
  mapProvider,
  onSelect
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedTotal, setSelectedTotal] = useState<number | undefined>()
  const [fallbackReason, setFallbackReason] = useState<FallbackReason | null>(
    null
  )

  // A changed provider (or access token) gets a fresh attempt. New points do
  // not: once the map has failed, "Try again" is the retry.
  const providerType = mapProvider.type
  const providerAccessToken =
    mapProvider.type === 'mapbox' ? mapProvider.accessToken : undefined
  useEffect(() => {
    setFallbackReason(null)
  }, [providerType, providerAccessToken])

  const selectedPoints = selectedIds.flatMap((id) => {
    const found = points.find((point) => point.mediaId === id)
    return found ? [found] : []
  })
  const pickGroup = (mediaIds: string[], total?: number) => {
    setSelectedIds(mediaIds)
    setSelectedTotal(total)
  }
  const pickOne = (mediaId: string) => pickGroup([mediaId])
  const hasAreaPoints = points.some((point) => point.precision === 'area')

  if (points.length === 0) {
    return (
      <FitnessEmptyState
        icon={MapPin}
        title="No photos or videos with a place yet"
      >
        Photos and videos that carry a place show up here.
      </FitnessEmptyState>
    )
  }

  return (
    <div className="space-y-6">
      {fallbackReason ? (
        <FitnessAlert
          title="Map unavailable"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFallbackReason(null)}
            >
              Try again
            </Button>
          }
        >
          The places are still listed below.
        </FitnessAlert>
      ) : (
        <div
          role="region"
          aria-label="Gallery map"
          data-map-provider={providerType}
          className={cn(
            'bg-muted relative overflow-hidden rounded-xl border',
            MAP_HEIGHT_CLASS
          )}
        >
          {mapProvider.type === 'apple' ? (
            <GalleryMapKit
              points={points}
              onPick={pickOne}
              onPickGroup={pickGroup}
              onUnavailable={() => setFallbackReason('render-failed')}
            />
          ) : (
            <GalleryGlMapSurface
              points={points}
              mapProvider={mapProvider}
              onPick={pickOne}
              onPickGroup={pickGroup}
              onUnavailable={setFallbackReason}
            />
          )}
          {selectedPoints.length === 1 ? (
            <SelectionCard
              point={selectedPoints[0]}
              onClose={() => setSelectedIds([])}
              onOpen={onSelect}
            />
          ) : selectedPoints.length > 1 ? (
            <SelectionListCard
              points={selectedPoints}
              total={selectedTotal}
              onClose={() => setSelectedIds([])}
              onOpen={onSelect}
              onFocusPoint={pickOne}
            />
          ) : null}
          {hasAreaPoints ? (
            <span className="bg-background/90 text-muted-foreground pointer-events-none absolute top-3 right-3 rounded px-2 py-1 text-xs shadow-sm max-sm:hidden">
              Markers show the area, not the exact spot
            </span>
          ) : null}
        </div>
      )}

      <GalleryPlacesList points={points} onOpen={onSelect} />
    </div>
  )
}
