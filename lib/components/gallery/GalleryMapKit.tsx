'use client'

import { Loader2 } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

import {
  APPLE_MAPS_LABEL,
  MAPKIT_LOAD_TIMEOUT_MS,
  type MapKitAnnotation,
  type MapKitCoordinate,
  type MapKitMapSurface,
  type MapKitSurfaceModule,
  boundsToRegion,
  loadMapKitSurface,
  mutedStandardMapType
} from '@/lib/components/fitness/mapkitSurface'
import { createGalleryMarkerElement } from '@/lib/components/gallery/galleryMapMarker'
import { getPointBounds } from '@/lib/components/gallery/galleryPlaces'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'

/** MapKit clusters annotations that share this identifier. */
export const GALLERY_CLUSTERING_IDENTIFIER = 'gallery-media'
// A single point (or a tight group) still frames with some surrounding context.
const MIN_FRAME_SPAN_DEG = 0.05
const CLUSTER_ZOOM_DIVISOR = 3
// Below this span (about 200 m) a cluster is photos at one spot, as with the
// 0.05 degree snapped `area` points: zooming further reveals nothing, so a tap
// picks the newest photo instead.
const CLUSTER_PICK_SPAN_DEG = 0.002

// What a cluster hands the `annotationForCluster` callback, and the member data
// the annotations carry. MapKit is loaded from a CDN, so this models only the
// members read here.
interface MemberData {
  mediaId: string
  thumbnailUrl: string | null
  // Position in `points`, which the server returns newest first; the lowest is
  // the newest member.
  order: number
}
interface ClusterAnnotation {
  coordinate: MapKitCoordinate
  memberAnnotations: Array<{ data?: MemberData }>
}
type ClusteringMap = MapKitMapSurface & {
  annotationForCluster?: (cluster: ClusterAnnotation) => MapKitAnnotation
}

export interface GalleryMapKitProps {
  points: GalleryMapPoint[]
  /** A single photo's marker was tapped. */
  onPick: (mediaId: string) => void
  /** MapKit can't load or render, so the caller can show its fallback. */
  onUnavailable: () => void
}

/**
 * Apple MapKit JS sibling of the GL gallery map. Each point is a custom
 * thumbnail annotation with a `clusteringIdentifier`, and
 * `annotationForCluster` draws a cluster as the newest member's thumbnail with
 * a count badge, so it matches the MapLibre / Mapbox markers.
 */
export const GalleryMapKit: FC<GalleryMapKitProps> = ({
  points,
  onPick,
  onUnavailable
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<ClusteringMap | null>(null)
  const mapkitRef = useRef<MapKitSurfaceModule | null>(null)
  const annotationsRef = useRef<MapKitAnnotation[]>([])
  const [isReady, setIsReady] = useState(false)
  const pointsRef = useRef(points)
  const onPickRef = useRef(onPick)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => {
    pointsRef.current = points
    onPickRef.current = onPick
    onUnavailableRef.current = onUnavailable
  }, [points, onPick, onUnavailable])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    const loadWatchdog = setTimeout(() => {
      if (!cancelled) onUnavailableRef.current()
    }, MAPKIT_LOAD_TIMEOUT_MS)

    loadMapKitSurface()
      .then((mapkit) => {
        if (cancelled) return
        try {
          const map = new mapkit.Map(container, {
            mapType: mutedStandardMapType(mapkit),
            showsMapTypeControl: false
          }) as ClusteringMap
          mapRef.current = map
          mapkitRef.current = mapkit

          map.annotationForCluster = (cluster) => {
            const members = cluster.memberAnnotations
            // `memberAnnotations` has no guaranteed order, so the newest member
            // (a thumbnail one if any has it) is picked by position in `points`.
            const byNewest = [...members]
              .filter((member) => member.data)
              .sort((a, b) => a.data!.order - b.data!.order)
            const representative =
              byNewest.find((member) => member.data?.thumbnailUrl) ??
              byNewest[0]
            return new mapkit.Annotation(
              cluster.coordinate,
              () =>
                createGalleryMarkerElement({
                  thumbnailUrl: representative?.data?.thumbnailUrl ?? null,
                  count: members.length,
                  label: `${members.length} photos and videos close together, zoom in`,
                  onClick: () => {
                    const { span } = map.region
                    if (
                      span.latitudeDelta < CLUSTER_PICK_SPAN_DEG &&
                      representative?.data
                    ) {
                      onPickRef.current(representative.data.mediaId)
                      return
                    }
                    map.setRegionAnimated(
                      new mapkit.CoordinateRegion(
                        new mapkit.Coordinate(
                          cluster.coordinate.latitude,
                          cluster.coordinate.longitude
                        ),
                        new mapkit.CoordinateSpan(
                          span.latitudeDelta / CLUSTER_ZOOM_DIVISOR,
                          span.longitudeDelta / CLUSTER_ZOOM_DIVISOR
                        )
                      ),
                      true
                    )
                  }
                }),
              { animates: false }
            )
          }

          clearTimeout(loadWatchdog)
          setIsReady(true)
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
      annotationsRef.current = []
      mapRef.current?.destroy()
      mapRef.current = null
      mapkitRef.current = null
      setIsReady(false)
    }
  }, [])

  // Redraw the annotations and reframe whenever the points change.
  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapkitRef.current
    if (!isReady || !map || !mapkit) return

    for (const annotation of annotationsRef.current) {
      map.removeAnnotation(annotation)
    }
    annotationsRef.current = pointsRef.current.map((point, order) => {
      const annotation = new mapkit.Annotation(
        new mapkit.Coordinate(point.latitude, point.longitude),
        () =>
          createGalleryMarkerElement({
            thumbnailUrl: point.thumbnailUrl,
            count: 1,
            label: point.subjectName
              ? `${point.subjectName}, open details`
              : 'Photo or video, open details',
            onClick: () => onPickRef.current(point.mediaId)
          }),
        {
          animates: false,
          clusteringIdentifier: GALLERY_CLUSTERING_IDENTIFIER,
          data: {
            mediaId: point.mediaId,
            thumbnailUrl: point.thumbnailUrl,
            order
          } satisfies MemberData
        }
      )
      map.addAnnotation(annotation)
      return annotation
    })

    const bounds = getPointBounds(pointsRef.current)
    if (bounds) {
      const region = boundsToRegion(mapkit, bounds)
      region.span.latitudeDelta = Math.max(
        region.span.latitudeDelta,
        MIN_FRAME_SPAN_DEG
      )
      region.span.longitudeDelta = Math.max(
        region.span.longitudeDelta,
        MIN_FRAME_SPAN_DEG
      )
      map.region = region
    }
  }, [isReady, points])

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {!isReady ? (
        <div
          role="status"
          className="bg-background/60 text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm"
        >
          <Loader2 className="size-4 animate-spin" /> Loading map…
        </div>
      ) : (
        <span className="bg-background/90 text-muted-foreground pointer-events-none absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
          {APPLE_MAPS_LABEL}
        </span>
      )}
    </>
  )
}
