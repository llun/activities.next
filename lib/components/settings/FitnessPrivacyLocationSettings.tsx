'use client'

import { ChevronDown } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  FitnessPrivacyRadiusMeters,
  sanitizePrivacyRadiusMeters
} from '@/lib/services/fitness-files/privacy'
import { loadMapboxModule } from '@/lib/utils/mapbox'

interface Props {
  mapboxAccessToken?: string
}

interface FitnessGeneralSettingsResponse {
  success?: boolean
  error?: string
  privacyHomeLatitude: number | null
  privacyHomeLongitude: number | null
  privacyHideRadiusMeters: number
}

interface RegenerateMapsResponse {
  success?: boolean
  error?: string
  queuedCount?: number
}

interface MapPointGeometry {
  type: 'Point'
  coordinates: [number, number]
}

interface MapFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: MapPointGeometry
    properties: Record<string, never>
  }>
}

interface MapboxGeoJSONSource {
  setData: (data: MapFeatureCollection) => void
}

interface MapboxMap {
  addSource: (id: string, source: Record<string, unknown>) => void
  addLayer: (layer: Record<string, unknown>) => void
  getSource: (id: string) => unknown
  once: (event: 'load', listener: () => void) => void
  on: (
    event: 'click',
    listener: (event: {
      lngLat: {
        lng: number
        lat: number
      }
    }) => void
  ) => void
  flyTo: (options: {
    center: [number, number]
    zoom?: number
    duration?: number
  }) => void
  remove: () => void
}

interface MapboxModule {
  accessToken: string
  Map: new (options: {
    container: HTMLElement
    style: string
    attributionControl: boolean
    center: [number, number]
    zoom: number
  }) => MapboxMap
}

const MAPBOX_MARKER_SOURCE_ID = 'fitness-privacy-home-marker'
const DEFAULT_MAP_CENTER: [number, number] = [5.2913, 52.1326]
const DEFAULT_MAP_ZOOM = 6
const CURRENT_LOCATION_ZOOM = 13
const HOME_MARKER_ZOOM = 13

const parseCoordinateInput = (value: string): number | null => {
  if (value.trim().length === 0) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const isLatitudeValid = (value: number) => value >= -90 && value <= 90
const isLongitudeValid = (value: number) => value >= -180 && value <= 180

const toMarkerFeatureCollection = (
  markerCoordinates: [number, number] | null
): MapFeatureCollection => {
  if (!markerCoordinates) {
    return {
      type: 'FeatureCollection',
      features: []
    }
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: markerCoordinates
        }
      }
    ]
  }
}

const formatCoordinate = (value: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }

  return value.toFixed(6)
}

const getBrowserCurrentLocation = async (): Promise<
  [number, number] | null
> => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return null
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve([position.coords.longitude, position.coords.latitude])
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 4000,
        maximumAge: 300000
      }
    )
  })
}

const getInitialMapView = async (): Promise<{
  center: [number, number]
  zoom: number
}> => {
  const currentLocation = await getBrowserCurrentLocation()
  if (currentLocation) {
    return {
      center: currentLocation,
      zoom: CURRENT_LOCATION_ZOOM
    }
  }

  return {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM
  }
}

export const FitnessPrivacyLocationSettings: FC<Props> = ({
  mapboxAccessToken
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markerCoordinatesRef = useRef<[number, number] | null>(null)
  const isHydratingSettingsRef = useRef(true)

  const [latitudeInput, setLatitudeInput] = useState('')
  const [longitudeInput, setLongitudeInput] = useState('')
  const [radiusMeters, setRadiusMeters] =
    useState<FitnessPrivacyRadiusMeters>(0)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRegeneratingMaps, setIsRegeneratingMaps] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)

  const markerCoordinates = useMemo<[number, number] | null>(() => {
    const latitude = parseCoordinateInput(latitudeInput)
    const longitude = parseCoordinateInput(longitudeInput)

    if (latitude === null || longitude === null) {
      return null
    }

    if (!isLatitudeValid(latitude) || !isLongitudeValid(longitude)) {
      return null
    }

    return [longitude, latitude]
  }, [latitudeInput, longitudeInput])
  markerCoordinatesRef.current = markerCoordinates

  const flyToMarker = useCallback(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const nextMarkerCoordinates = markerCoordinatesRef.current
    if (!nextMarkerCoordinates) {
      return
    }

    map.flyTo({
      center: nextMarkerCoordinates,
      zoom: HOME_MARKER_ZOOM,
      duration: 500
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    const fetchSettings = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch('/api/v1/settings/fitness/general', {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })

        if (!response.ok) {
          throw new Error('Failed to load fitness privacy settings')
        }

        const data = (await response.json()) as FitnessGeneralSettingsResponse

        if (cancelled) {
          return
        }

        setLatitudeInput(formatCoordinate(data.privacyHomeLatitude))
        setLongitudeInput(formatCoordinate(data.privacyHomeLongitude))
        setRadiusMeters(
          sanitizePrivacyRadiusMeters(data.privacyHideRadiusMeters)
        )
      } catch {
        if (cancelled) {
          return
        }

        setError('Failed to load fitness privacy settings')
      } finally {
        isHydratingSettingsRef.current = false
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchSettings()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!mapboxAccessToken || !mapContainerRef.current) {
      mapRef.current?.remove()
      mapRef.current = null
      return
    }

    let cancelled = false

    const initializeMap = async () => {
      try {
        const mapbox = await loadMapboxModule<MapboxModule>()
        if (cancelled || !mapContainerRef.current) {
          return
        }

        mapbox.accessToken = mapboxAccessToken

        const initialView = await getInitialMapView()

        const map = new mapbox.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/outdoors-v12',
          attributionControl: false,
          center: initialView.center,
          zoom: initialView.zoom
        })

        mapRef.current = map

        map.once('load', () => {
          if (cancelled || !mapRef.current) {
            return
          }

          map.addSource(MAPBOX_MARKER_SOURCE_ID, {
            type: 'geojson',
            data: toMarkerFeatureCollection(markerCoordinatesRef.current)
          })

          map.addLayer({
            id: 'fitness-privacy-home-marker-core',
            type: 'circle',
            source: MAPBOX_MARKER_SOURCE_ID,
            paint: {
              'circle-radius': 7,
              'circle-color': '#16a34a',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2
            }
          })

          map.addLayer({
            id: 'fitness-privacy-home-marker-ring',
            type: 'circle',
            source: MAPBOX_MARKER_SOURCE_ID,
            paint: {
              'circle-radius': 14,
              'circle-color': '#16a34a',
              'circle-opacity': 0.2
            }
          })
        })

        map.on('click', ({ lngLat }) => {
          setLatitudeInput(lngLat.lat.toFixed(6))
          setLongitudeInput(lngLat.lng.toFixed(6))
          setError(null)
          setMessage(null)
        })

        setMapLoadError(null)
      } catch {
        if (cancelled) {
          return
        }

        setMapLoadError('Map picker unavailable. Use manual coordinates below.')
      }
    }

    void initializeMap()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [mapboxAccessToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const source = map.getSource(MAPBOX_MARKER_SOURCE_ID) as
      | MapboxGeoJSONSource
      | undefined

    if (!source) {
      return
    }

    source.setData(toMarkerFeatureCollection(markerCoordinates))

    const activeElementId =
      typeof document !== 'undefined' ? document.activeElement?.id : undefined
    const isCoordinateInputFocused =
      activeElementId === 'privacyHomeLatitude' ||
      activeElementId === 'privacyHomeLongitude'

    if (
      markerCoordinates &&
      !isHydratingSettingsRef.current &&
      !isCoordinateInputFocused
    ) {
      flyToMarker()
    }
  }, [flyToMarker, markerCoordinates])

  const validateSettings = (): string | null => {
    const hasLatitude = latitudeInput.trim().length > 0
    const hasLongitude = longitudeInput.trim().length > 0

    if (hasLatitude !== hasLongitude) {
      return 'Latitude and longitude must be provided together.'
    }

    const latitude = parseCoordinateInput(latitudeInput)
    const longitude = parseCoordinateInput(longitudeInput)

    if (latitude !== null && !isLatitudeValid(latitude)) {
      return 'Latitude must be between -90 and 90.'
    }

    if (longitude !== null && !isLongitudeValid(longitude)) {
      return 'Longitude must be between -180 and 180.'
    }

    if (radiusMeters > 0 && (latitude === null || longitude === null)) {
      return 'Set a home location before using privacy radius greater than 0.'
    }

    return null
  }

  const saveSettings = async ({
    latitude,
    longitude,
    radius
  }: {
    latitude: number | null
    longitude: number | null
    radius: FitnessPrivacyRadiusMeters
  }): Promise<boolean> => {
    try {
      setIsSaving(true)

      const response = await fetch('/api/v1/settings/fitness/general', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          privacyHomeLatitude: latitude,
          privacyHomeLongitude: longitude,
          privacyHideRadiusMeters: radius
        })
      })

      const data = (await response.json()) as FitnessGeneralSettingsResponse

      if (!response.ok) {
        setError(
          data?.error || 'Failed to save fitness privacy location settings'
        )
        return false
      }

      setLatitudeInput(formatCoordinate(data.privacyHomeLatitude))
      setLongitudeInput(formatCoordinate(data.privacyHomeLongitude))
      setRadiusMeters(sanitizePrivacyRadiusMeters(data.privacyHideRadiusMeters))
      return true
    } catch {
      setError('Failed to save fitness privacy location settings')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async () => {
    setError(null)
    setMessage(null)

    const validationError = validateSettings()
    if (validationError) {
      setError(validationError)
      return
    }

    const latitude = parseCoordinateInput(latitudeInput)
    const longitude = parseCoordinateInput(longitudeInput)
    const saved = await saveSettings({
      latitude,
      longitude,
      radius: radiusMeters
    })

    if (saved) {
      setMessage('Fitness privacy location settings saved.')
    }
  }

  const handleClear = async () => {
    setError(null)
    setMessage(null)

    const saved = await saveSettings({
      latitude: null,
      longitude: null,
      radius: 0
    })

    if (saved) {
      setMessage('Fitness privacy location settings cleared.')
    }
  }

  const handleRegenerateOldStatusMaps = async () => {
    setError(null)
    setMessage(null)
    setIsRegeneratingMaps(true)

    try {
      const response = await fetch(
        '/api/v1/settings/fitness/general/regenerate-maps',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      const data = (await response.json()) as RegenerateMapsResponse

      if (!response.ok) {
        setError(data.error || 'Failed to queue map regeneration job.')
        return
      }

      const queuedCount =
        typeof data.queuedCount === 'number' ? data.queuedCount : 0
      if (queuedCount === 0) {
        setMessage('No old statuses are pending map regeneration.')
      } else {
        setMessage(
          `Queued map regeneration for ${queuedCount} old status${queuedCount > 1 ? 'es' : ''}.`
        )
      }
    } catch {
      setError('Failed to queue map regeneration job.')
    } finally {
      setIsRegeneratingMaps(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy Location</CardTitle>
        <CardDescription>
          Hide GPS points near your home location from shared maps and generated
          route images.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mapboxAccessToken ? (
          <div className="space-y-2">
            <Label>Home Marker</Label>
            <div className="relative h-64 overflow-hidden rounded-md border">
              <div ref={mapContainerRef} className="h-full w-full" />
              {mapLoadError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/95 px-4 text-sm text-muted-foreground">
                  {mapLoadError}
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Click the map to set your home marker.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Mapbox access token is not configured. Enter latitude and longitude
            manually.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="privacyHomeLatitude">Latitude</Label>
            <Input
              id="privacyHomeLatitude"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 37.774900"
              value={latitudeInput}
              onChange={(event) => setLatitudeInput(event.target.value)}
              onBlur={() => {
                if (!isHydratingSettingsRef.current) {
                  flyToMarker()
                }
              }}
              disabled={isLoading || isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="privacyHomeLongitude">Longitude</Label>
            <Input
              id="privacyHomeLongitude"
              type="text"
              inputMode="decimal"
              placeholder="e.g. -122.419400"
              value={longitudeInput}
              onChange={(event) => setLongitudeInput(event.target.value)}
              onBlur={() => {
                if (!isHydratingSettingsRef.current) {
                  flyToMarker()
                }
              }}
              disabled={isLoading || isSaving}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="privacyHideRadiusMeters">Hide Radius</Label>
          <div className="relative">
            <select
              id="privacyHideRadiusMeters"
              value={String(radiusMeters)}
              onChange={(event) => {
                setRadiusMeters(
                  sanitizePrivacyRadiusMeters(Number(event.target.value))
                )
              }}
              disabled={isLoading || isSaving}
              className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {FITNESS_PRIVACY_RADIUS_OPTIONS.map((radius) => (
                <option key={radius} value={radius}>
                  {radius}m
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">
            Any GPS points inside this radius are hidden for other viewers.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {message ? <p className="text-sm text-green-600">{message}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleSave}
            disabled={isLoading || isSaving || isRegeneratingMaps}
          >
            {isSaving ? 'Saving...' : 'Save privacy location'}
          </Button>
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={isLoading || isSaving || isRegeneratingMaps}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            onClick={handleRegenerateOldStatusMaps}
            disabled={isLoading || isSaving || isRegeneratingMaps}
          >
            {isRegeneratingMaps
              ? 'Queueing regeneration...'
              : 'Regenerate maps for old statuses'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
