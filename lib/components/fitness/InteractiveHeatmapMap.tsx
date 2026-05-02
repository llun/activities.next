'use client'

import { FC, useEffect, useRef, useState } from 'react'
import { loadMapboxModule } from '@/lib/utils/mapbox'

interface Props {
  mapboxAccessToken?: string
  geojson: any
}

export const InteractiveHeatmapMap: FC<Props> = ({
  mapboxAccessToken,
  geojson
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  useEffect(() => {
    if (!mapboxAccessToken || !mapContainerRef.current) return

    let cancelled = false
    let map: any

    const initMap = async () => {
      try {
        const mapboxgl: any = await loadMapboxModule()
        if (cancelled) return

        mapboxgl.accessToken = mapboxAccessToken
        map = new mapboxgl.Map({
          container: mapContainerRef.current!,
          style: 'mapbox://styles/mapbox/light-v11',
          attributionControl: true,
          center: [0, 0],
          zoom: 1
        })

        map.on('load', () => {
          if (cancelled) {
            map.remove()
            return
          }
          mapRef.current = map
          setMapLoaded(true)
        })
      } catch (error) {
        console.error('Failed to load mapbox:', error)
      }
    }

    initMap()

    return () => {
      cancelled = true
      if (map) {
        map.remove()
      }
    }
  }, [mapboxAccessToken])

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !geojson) return

    const map = mapRef.current
    const sourceId = 'heatmap-routes'
    const layerId = 'heatmap-layer'

    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(geojson)
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson
      })

      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#ff3b30',
          'line-width': 2,
          'line-opacity': 0.6
        }
      })
    }

    // Fit map to bounds
    if (geojson.features.length > 0) {
      const coordinates = geojson.features.flatMap((f: any) => f.geometry.coordinates)
      if (coordinates.length > 0) {
        const bounds = coordinates.reduce(
          (acc: any, coord: any) => [
            [Math.min(acc[0][0], coord[0]), Math.min(acc[0][1], coord[1])],
            [Math.max(acc[1][0], coord[0]), Math.max(acc[1][1], coord[1])]
          ],
          [[coordinates[0][0], coordinates[0][1]], [coordinates[0][0], coordinates[0][1]]]
        )
        map.fitBounds(bounds, { padding: 50, duration: 1000 })
      }
    }
  }, [mapLoaded, geojson])

  if (!mapboxAccessToken) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground">
        Mapbox access token is required for interactive heatmap.
      </div>
    )
  }

  return (
    <div
      ref={mapContainerRef}
      className="h-[500px] w-full rounded-lg border overflow-hidden"
    />
  )
}
