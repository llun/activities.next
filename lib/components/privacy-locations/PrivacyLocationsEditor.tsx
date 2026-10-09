'use client'

import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  PrivacyZoneMapKit,
  ZONE_COLOR,
  ZONE_FILL_OPACITY,
  ZONE_OUTLINE_WIDTH_PX
} from '@/lib/components/fitness/PrivacyZoneMapKit'
import { circleToPolygon } from '@/lib/components/fitness/mapGeometry'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  FitnessPrivacyRadiusMeters,
  sanitizePrivacyRadiusMeters
} from '@/lib/services/fitness-files/privacy'
import {
  type PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'

/** One saved zone: Fitness privacy locations and Gallery hidden locations. */
export interface PrivacyLocationInput {
  latitude: number
  longitude: number
  hideRadiusMeters: FitnessPrivacyRadiusMeters
}

/** Thrown by a `save` adapter so the editor shows the server's own message. */
export class PrivacyLocationsSaveError extends Error {}

/** The words that differ between the surfaces that share the editor. */
export interface PrivacyLocationsCopy {
  /** Shown after a successful save, e.g. "Fitness privacy location settings saved." */
  saved: string
  /** Shown after "Clear all" saved an empty list. */
  cleared: string
  /** Shown when a save fails without a server message. */
  saveFailed: string
  saveButton: string
  /** The paragraph under the Hide Radius select. */
  hideRadiusHelp: string
}

/**
 * What the footer slot receives, so a surface-specific button (Fitness's
 * "Regenerate maps") joins the editor's shared busy state and messages.
 */
export interface PrivacyLocationsFooterContext {
  /** Loading, saving or locating: the editor is not ready for another action. */
  disabled: boolean
  /** The footer itself has an action in flight; the editor's buttons wait. */
  busy: boolean
  setBusy: (busy: boolean) => void
  setError: (message: string | null) => void
  setMessage: (message: string | null) => void
}

export interface PrivacyLocationsEditorProps {
  /** Which map backend renders the location picker. */
  mapProvider: PublicMapProvider
  /** Reads the stored locations. A rejection is a failed load. */
  load: () => Promise<PrivacyLocationInput[]>
  /**
   * Replaces the stored list and returns what was stored. Throw a
   * `PrivacyLocationsSaveError` to show a specific message.
   */
  save: (locations: PrivacyLocationInput[]) => Promise<PrivacyLocationInput[]>
  copy: PrivacyLocationsCopy
  /** Prefix of the GL source and layer ids, so two editors never collide. */
  mapIdPrefix: string
  /** Extra buttons at the end of the action row. */
  footer?: ReactNode | ((context: PrivacyLocationsFooterContext) => ReactNode)
  /** Reports whether editing is disabled (loading, failed load, saving). */
  onEditingDisabledChange?: (disabled: boolean) => void
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

interface MapPolygonGeometry {
  type: 'Polygon'
  coordinates: [number, number][][]
}

interface MapZoneFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: MapPolygonGeometry
    properties: Record<string, never>
  }>
}

interface MapboxGeoJSONSource {
  setData: (data: MapFeatureCollection | MapZoneFeatureCollection) => void
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

// The Mapbox GL / MapLibre GL surface this picker drives — both libraries share
// the `Map` constructor subset used here, so one code path renders either.
interface MapboxModule {
  Map: new (options: Record<string, unknown>) => MapboxMap
}

const DEFAULT_MAP_CENTER: [number, number] = [5.2913, 52.1326]
const DEFAULT_MAP_ZOOM = 6
const CURRENT_LOCATION_ZOOM = 13
const HOME_MARKER_ZOOM = 13
const CURRENT_LOCATION_TIMEOUT_MS = 10000
const CURRENT_LOCATION_MAX_AGE_MS = 0
const FALLBACK_LOCATION_TIMEOUT_MS = 15000
const FALLBACK_LOCATION_MAX_AGE_MS = 3600000
const NON_ZERO_RADIUS_OPTIONS = FITNESS_PRIVACY_RADIUS_OPTIONS.filter(
  (radius) => radius > 0
) as FitnessPrivacyRadiusMeters[]
const DEFAULT_DRAFT_RADIUS = sanitizePrivacyRadiusMeters(
  NON_ZERO_RADIUS_OPTIONS[0] ?? 0
)

const formatRadiusLabel = (radiusMeters: number) =>
  radiusMeters >= 1000 ? `${radiusMeters / 1000}km` : `${radiusMeters}m`

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

// A saved zone and the draft marker are the same circle when the draft was
// prefilled from it (or just added it to the list); drawing both would stack two
// 20% fills into a visibly darker one. Coordinates compare to the 6 decimals the
// fields carry, so a stored value with extra digits still counts as the same.
const COORDINATE_TOLERANCE_DEG = 1e-6

/**
 * Every hide radius the picker should show, as polygons the GL engine can fill:
 * one circle per saved zone, plus one at the draft marker at the radius
 * currently selected — so the radius select visibly resizes what the click will
 * hide, instead of the marker staying a fixed-size dot whatever is chosen.
 */
const toZoneFeatureCollection = (
  draftCoordinates: [number, number] | null,
  draftRadiusMeters: number,
  savedZones: PrivacyLocationInput[]
): MapZoneFeatureCollection => {
  const zones: Array<{
    center: { lat: number; lng: number }
    radiusMeters: number
  }> = savedZones.map((zone) => ({
    center: { lat: zone.latitude, lng: zone.longitude },
    radiusMeters: zone.hideRadiusMeters
  }))

  if (draftCoordinates && draftRadiusMeters > 0) {
    const [draftLongitude, draftLatitude] = draftCoordinates
    const isSavedAlready = savedZones.some(
      (zone) =>
        zone.hideRadiusMeters === draftRadiusMeters &&
        Math.abs(zone.latitude - draftLatitude) < COORDINATE_TOLERANCE_DEG &&
        Math.abs(zone.longitude - draftLongitude) < COORDINATE_TOLERANCE_DEG
    )
    if (!isSavedAlready) {
      zones.push({
        center: { lat: draftLatitude, lng: draftLongitude },
        radiusMeters: draftRadiusMeters
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      properties: {},
      geometry: circleToPolygon(zone.center, zone.radiusMeters)
    }))
  }
}

const formatCoordinate = (value: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }

  return value.toFixed(6)
}

const sanitizeDraftRadius = (value: unknown): FitnessPrivacyRadiusMeters => {
  const radius = sanitizePrivacyRadiusMeters(value)
  return radius > 0 ? radius : DEFAULT_DRAFT_RADIUS
}

type DraftField = 'coordinates' | 'radius'

interface DraftFieldError {
  field: DraftField
  message: string
}

interface BrowserCurrentLocationError {
  code: number | 'unavailable'
  message: string
}

interface BrowserCurrentLocationResult {
  coordinates: [number, number] | null
  error?: BrowserCurrentLocationError
}

interface BrowserCurrentLocationOptions {
  enableHighAccuracy?: boolean
  timeout?: number
  maximumAge?: number
}

const requestBrowserCurrentLocation = (
  options: BrowserCurrentLocationOptions
): Promise<BrowserCurrentLocationResult> => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({
      coordinates: null,
      error: {
        code: 'unavailable',
        message: 'Geolocation API is not available in this browser.'
      }
    })
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          coordinates: [position.coords.longitude, position.coords.latitude]
        })
      },
      (error) => {
        resolve({
          coordinates: null,
          error: {
            code: error.code,
            message: error.message
          }
        })
      },
      options
    )
  })
}

const getCurrentLocationErrorMessage = (
  error?: BrowserCurrentLocationError
): string => {
  if (!error) {
    return 'Unable to detect your current browser location. Please allow location access and try again.'
  }

  if (error.code === 1) {
    return 'Location permission is denied. Please allow location access in your browser/site settings and try again.'
  }

  if (error.code === 2) {
    const providerMessage =
      error.message && error.message.length > 0 ? ` (${error.message})` : ''
    return `Location provider is unavailable in this browser process.${providerMessage} Check OS location services for this app/browser and try again.`
  }

  if (error.code === 3) {
    return 'Location request timed out. Please try again or move to an area with better location signal.'
  }

  if (error.code === 'unavailable') {
    return 'Geolocation is unavailable in this browser context.'
  }

  return error.message || 'Unable to detect your current browser location.'
}

const getBrowserCurrentLocation =
  async (): Promise<BrowserCurrentLocationResult> => {
    const primaryAttempt = await requestBrowserCurrentLocation({
      enableHighAccuracy: true,
      timeout: CURRENT_LOCATION_TIMEOUT_MS,
      maximumAge: CURRENT_LOCATION_MAX_AGE_MS
    })
    if (primaryAttempt.coordinates) {
      return primaryAttempt
    }

    const fallbackAttempt = await requestBrowserCurrentLocation({
      enableHighAccuracy: false,
      timeout: FALLBACK_LOCATION_TIMEOUT_MS,
      maximumAge: FALLBACK_LOCATION_MAX_AGE_MS
    })

    if (fallbackAttempt.coordinates) {
      return fallbackAttempt
    }

    return fallbackAttempt.error ? fallbackAttempt : primaryAttempt
  }

const getInitialMapView = async (): Promise<{
  center: [number, number]
  zoom: number
}> => {
  const currentLocation = (await getBrowserCurrentLocation()).coordinates
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

export const PrivacyLocationsEditor: FC<PrivacyLocationsEditorProps> = ({
  mapProvider,
  load,
  save,
  copy,
  mapIdPrefix,
  footer,
  onEditingDisabledChange
}) => {
  const markerSourceId = `${mapIdPrefix}-home-marker`
  const zoneSourceId = `${mapIdPrefix}-zones`
  // The adapters and copy are read through refs: the load effect and the map's
  // long-lived handlers must not restart because a parent re-rendered with an
  // inline function.
  const loadRef = useRef(load)
  const saveRef = useRef(save)
  const copyRef = useRef(copy)
  loadRef.current = load
  saveRef.current = save
  copyRef.current = copy
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const latitudeInputRef = useRef<HTMLInputElement>(null)
  const longitudeInputRef = useRef<HTMLInputElement>(null)
  const radiusSelectRef = useRef<HTMLSelectElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markerCoordinatesRef = useRef<[number, number] | null>(null)
  const isHydratingSettingsRef = useRef(true)

  const [latitudeInput, setLatitudeInput] = useState('')
  const [longitudeInput, setLongitudeInput] = useState('')
  const [draftRadiusMeters, setDraftRadiusMeters] =
    useState<FitnessPrivacyRadiusMeters>(DEFAULT_DRAFT_RADIUS)
  const [privacyLocations, setPrivacyLocations] = useState<
    PrivacyLocationInput[]
  >([])

  const [isLoading, setIsLoading] = useState(true)
  // Only true once the existing settings have actually been read back. Saving
  // builds the payload from `privacyLocations`, and a save REPLACES the whole
  // stored list — so saving before a successful load would destroy every zone
  // the actor has configured.
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false)
  const [settingsReloadToken, setSettingsReloadToken] = useState(0)
  // The map's click handler is registered once, inside the init effect, so it
  // cannot read `hasLoadedSettings` directly without going stale.
  const hasLoadedSettingsRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isFooterBusy, setIsFooterBusy] = useState(false)
  const [isLocatingCurrentPosition, setIsLocatingCurrentPosition] =
    useState(false)
  const [isMapReady, setIsMapReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Validation of the draft fields, shown under the input it is about rather
  // than as a request failure.
  const [fieldError, setFieldError] = useState<DraftFieldError | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)

  // Keyed on the descriptor's fields (not its object identity) so an inline prop
  // literal doesn't recreate the map on every parent render. Apple renders
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

  const zoneFeatureCollection = useMemo(
    () =>
      toZoneFeatureCollection(
        markerCoordinates,
        draftRadiusMeters,
        privacyLocations
      ),
    [markerCoordinates, draftRadiusMeters, privacyLocations]
  )
  const zoneFeatureCollectionRef = useRef(zoneFeatureCollection)
  zoneFeatureCollectionRef.current = zoneFeatureCollection

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

  const syncWithCurrentLocation = useCallback(
    async ({
      showSuccessMessage,
      showFailureMessage
    }: {
      showSuccessMessage?: boolean
      showFailureMessage?: boolean
    } = {}): Promise<boolean> => {
      const { coordinates: currentLocation, error: locationError } =
        await getBrowserCurrentLocation()
      if (!currentLocation) {
        if (showFailureMessage) {
          setError(getCurrentLocationErrorMessage(locationError))
        }
        return false
      }

      const [longitude, latitude] = currentLocation
      setLatitudeInput(latitude.toFixed(6))
      setLongitudeInput(longitude.toFixed(6))

      const map = mapRef.current
      if (map) {
        map.flyTo({
          center: currentLocation,
          zoom: CURRENT_LOCATION_ZOOM,
          duration: 500
        })
      }

      if (showSuccessMessage) {
        setMessage('Location updated from your browser.')
      }
      return true
    },
    []
  )

  useEffect(() => {
    let cancelled = false

    const fetchSettings = async () => {
      try {
        isHydratingSettingsRef.current = true
        setIsLoading(true)
        setError(null)
        setFieldError(null)

        const locations = await loadRef.current()

        if (cancelled) {
          return
        }

        const firstLocation = locations[0]

        setPrivacyLocations(locations)
        setLatitudeInput(formatCoordinate(firstLocation?.latitude ?? null))
        setLongitudeInput(formatCoordinate(firstLocation?.longitude ?? null))
        setDraftRadiusMeters(
          sanitizeDraftRadius(firstLocation?.hideRadiusMeters)
        )
        hasLoadedSettingsRef.current = true
        setHasLoadedSettings(true)
      } catch {
        if (cancelled) {
          return
        }

        hasLoadedSettingsRef.current = false
        setHasLoadedSettings(false)
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
  }, [settingsReloadToken])

  useEffect(() => {
    // Never prefill from the browser before the settings have loaded: on a load
    // failure it would dress an empty form up as a configured one.
    if (!isMapReady || isLoading || !hasLoadedSettings) {
      return
    }

    if (
      privacyLocations.length > 0 ||
      latitudeInput.trim().length > 0 ||
      longitudeInput.trim().length > 0
    ) {
      return
    }

    void syncWithCurrentLocation()
  }, [
    hasLoadedSettings,
    isLoading,
    isMapReady,
    latitudeInput,
    longitudeInput,
    privacyLocations.length,
    syncWithCurrentLocation
  ])

  useEffect(() => {
    if (!glProvider || !mapContainerRef.current) {
      mapRef.current?.remove()
      mapRef.current = null
      setIsMapReady(false)
      return
    }

    let cancelled = false

    const initializeMap = async () => {
      try {
        const mapbox = (await glProvider.loadModule()) as MapboxModule
        if (cancelled || !mapContainerRef.current) {
          return
        }

        const initialView = await getInitialMapView()

        const map = new mapbox.Map({
          container: mapContainerRef.current,
          attributionControl: false,
          center: initialView.center,
          zoom: initialView.zoom,
          // style (and, for Mapbox, accessToken) come from the resolved provider.
          ...glProvider.mapOptions
        })

        mapRef.current = map
        setIsMapReady(false)

        map.once('load', () => {
          if (cancelled || !mapRef.current) {
            return
          }

          map.addSource(markerSourceId, {
            type: 'geojson',
            data: toMarkerFeatureCollection(markerCoordinatesRef.current)
          })

          // The hide radius, drawn at its real size on the ground: a polygon per
          // zone, because a GL `circle` layer is sized in pixels, not metres.
          // Added before the marker so the point you clicked sits on top.
          map.addSource(zoneSourceId, {
            type: 'geojson',
            data: zoneFeatureCollectionRef.current
          })

          map.addLayer({
            id: `${mapIdPrefix}-zone-fill`,
            type: 'fill',
            source: zoneSourceId,
            paint: {
              'fill-color': ZONE_COLOR,
              'fill-opacity': ZONE_FILL_OPACITY
            }
          })

          map.addLayer({
            id: `${mapIdPrefix}-zone-outline`,
            type: 'line',
            source: zoneSourceId,
            paint: {
              'line-color': ZONE_COLOR,
              'line-width': ZONE_OUTLINE_WIDTH_PX
            }
          })

          map.addLayer({
            id: `${mapIdPrefix}-home-marker-core`,
            type: 'circle',
            source: markerSourceId,
            paint: {
              'circle-radius': 7,
              'circle-color': ZONE_COLOR,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2
            }
          })

          const initialMarkerCoordinates = markerCoordinatesRef.current
          if (initialMarkerCoordinates) {
            map.flyTo({
              center: initialMarkerCoordinates,
              zoom: HOME_MARKER_ZOOM,
              duration: 0
            })
          }

          setIsMapReady(true)
        })

        map.on('click', ({ lngLat }) => {
          // Writing into greyed-out fields would contradict the disabled
          // editing surface after a failed load.
          if (!hasLoadedSettingsRef.current) {
            return
          }

          setLatitudeInput(lngLat.lat.toFixed(6))
          setLongitudeInput(lngLat.lng.toFixed(6))
          setError(null)
          setFieldError(null)
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
      setIsMapReady(false)
    }
  }, [glProvider, markerSourceId, zoneSourceId, mapIdPrefix])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const source = map.getSource(markerSourceId) as
      MapboxGeoJSONSource | undefined

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
  }, [flyToMarker, markerCoordinates, markerSourceId])

  useEffect(() => {
    // `isMapReady` re-runs this once the source exists; before that the load
    // handler seeds it from the ref.
    const source = mapRef.current?.getSource(zoneSourceId) as
      MapboxGeoJSONSource | undefined

    source?.setData(zoneFeatureCollection)
  }, [isMapReady, zoneFeatureCollection, zoneSourceId])

  const buildDraftLocation = (): {
    location: PrivacyLocationInput | null
    error: DraftFieldError | null
  } => {
    const hasLatitude = latitudeInput.trim().length > 0
    const hasLongitude = longitudeInput.trim().length > 0

    if (!hasLatitude && !hasLongitude) {
      return {
        location: null,
        error: null
      }
    }

    if (hasLatitude !== hasLongitude) {
      return {
        location: null,
        error: {
          field: 'coordinates',
          message: 'Latitude and longitude must be provided together.'
        }
      }
    }

    const latitude = parseCoordinateInput(latitudeInput)
    const longitude = parseCoordinateInput(longitudeInput)

    if (latitude === null || !isLatitudeValid(latitude)) {
      return {
        location: null,
        error: {
          field: 'coordinates',
          message: 'Latitude must be between -90 and 90.'
        }
      }
    }

    if (longitude === null || !isLongitudeValid(longitude)) {
      return {
        location: null,
        error: {
          field: 'coordinates',
          message: 'Longitude must be between -180 and 180.'
        }
      }
    }

    if (draftRadiusMeters <= 0) {
      return {
        location: null,
        error: {
          field: 'radius',
          message: 'Hide radius must be greater than 0.'
        }
      }
    }

    return {
      location: {
        latitude,
        longitude,
        hideRadiusMeters: draftRadiusMeters
      },
      error: null
    }
  }

  const hasSamePrivacyLocation = (
    left: PrivacyLocationInput,
    right: PrivacyLocationInput
  ) => {
    return (
      left.latitude === right.latitude &&
      left.longitude === right.longitude &&
      left.hideRadiusMeters === right.hideRadiusMeters
    )
  }

  const saveSettings = async (
    locations: PrivacyLocationInput[]
  ): Promise<boolean> => {
    try {
      setIsSaving(true)

      const savedLocations = await saveRef.current(locations)
      const firstLocation = savedLocations[0]

      setPrivacyLocations(savedLocations)
      setLatitudeInput(formatCoordinate(firstLocation?.latitude ?? null))
      setLongitudeInput(formatCoordinate(firstLocation?.longitude ?? null))
      setDraftRadiusMeters(sanitizeDraftRadius(firstLocation?.hideRadiusMeters))
      return true
    } catch (saveError) {
      setError(
        saveError instanceof PrivacyLocationsSaveError && saveError.message
          ? saveError.message
          : copyRef.current.saveFailed
      )
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // Shows a field error and moves focus to the invalid control, so the linked
  // message is read with it.
  const showFieldError = (draftError: DraftFieldError) => {
    setFieldError(draftError)
    if (draftError.field === 'radius') {
      radiusSelectRef.current?.focus()
      return
    }
    const latitudeIsBad =
      latitudeInput.trim().length === 0 ||
      draftError.message.startsWith('Latitude must be between')
    ;(latitudeIsBad ? latitudeInputRef : longitudeInputRef).current?.focus()
  }

  const clearCoordinatesError = () =>
    setFieldError((current) =>
      current?.field === 'coordinates' ? null : current
    )

  const handleAddLocation = () => {
    setError(null)
    setFieldError(null)
    setMessage(null)

    const { location, error: locationError } = buildDraftLocation()

    if (locationError) {
      showFieldError(locationError)
      return
    }

    if (!location) {
      showFieldError({
        field: 'coordinates',
        message: 'Set latitude and longitude before adding a privacy location.'
      })
      return
    }

    if (
      privacyLocations.some((item) => hasSamePrivacyLocation(item, location))
    ) {
      setMessage('This privacy location is already in the list.')
      return
    }

    setPrivacyLocations((current) => [...current, location])
    setMessage('Privacy location added to list. Save settings to apply.')
  }

  const handleUseCurrentLocation = async () => {
    setError(null)
    setFieldError(null)
    setMessage(null)
    setIsLocatingCurrentPosition(true)

    try {
      await syncWithCurrentLocation({
        showSuccessMessage: true,
        showFailureMessage: true
      })
    } finally {
      setIsLocatingCurrentPosition(false)
    }
  }

  const handleRemoveLocation = (index: number) => {
    setError(null)
    setFieldError(null)
    setMessage(null)

    setPrivacyLocations((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index)
      return next
    })
    setLatitudeInput('')
    setLongitudeInput('')
    setDraftRadiusMeters(DEFAULT_DRAFT_RADIUS)

    setMessage('Privacy location removed from list. Save settings to apply.')
  }

  const handleSave = async () => {
    setError(null)
    setFieldError(null)
    setMessage(null)

    const { location, error: locationError } = buildDraftLocation()
    if (locationError) {
      showFieldError(locationError)
      return
    }

    const locationsToSave = [...privacyLocations]
    if (
      location &&
      !locationsToSave.some((item) => hasSamePrivacyLocation(item, location))
    ) {
      locationsToSave.push(location)
    }

    const saved = await saveSettings(locationsToSave)

    if (saved) {
      setMessage(copyRef.current.saved)
    }
  }

  const handleClear = async () => {
    setError(null)
    setFieldError(null)
    setMessage(null)

    const saved = await saveSettings([])

    if (saved) {
      setPrivacyLocations([])
      setLatitudeInput('')
      setLongitudeInput('')
      setDraftRadiusMeters(DEFAULT_DRAFT_RADIUS)
      setMessage(copyRef.current.cleared)
      void syncWithCurrentLocation()
    }
  }

  // Everything that edits the draft or the list is disabled until the existing
  // settings are known. Otherwise the user builds a list against an empty form
  // and is told to "save settings to apply" against a disabled Save button.
  const isEditingDisabled = isLoading || !hasLoadedSettings || isSaving
  const coordinatesError =
    fieldError?.field === 'coordinates' ? fieldError.message : null
  const radiusError = fieldError?.field === 'radius' ? fieldError.message : null

  // A layout effect, so the parent's copy of the flag updates in the same commit
  // instead of one render behind the controls it gates.
  useLayoutEffect(() => {
    onEditingDisabledChange?.(isEditingDisabled)
  }, [isEditingDisabled, onEditingDisabledChange])

  const footerContent =
    typeof footer === 'function'
      ? footer({
          disabled: isLoading || isSaving || isLocatingCurrentPosition,
          busy: isFooterBusy,
          setBusy: setIsFooterBusy,
          setError,
          setMessage
        })
      : footer

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {/* Every provider renders an interactive picker; the manual latitude /
        longitude fields below stay as the fallback when it fails to load. */}
      <div className="space-y-2">
        <Label>Location Marker</Label>
        <div className="relative h-64 overflow-hidden rounded-md border">
          {glProvider ? (
            <div ref={mapContainerRef} className="h-full w-full" />
          ) : (
            <PrivacyZoneMapKit
              marker={
                markerCoordinates
                  ? {
                      latitude: markerCoordinates[1],
                      longitude: markerCoordinates[0]
                    }
                  : null
              }
              zones={privacyLocations}
              onPick={({ latitude, longitude }) => {
                setLatitudeInput(latitude.toFixed(6))
                setLongitudeInput(longitude.toFixed(6))
                setError(null)
                setFieldError(null)
                setMessage(null)
              }}
              onReady={() => setIsMapReady(true)}
              onUnavailable={() =>
                setMapLoadError(
                  'Map picker unavailable. Use manual coordinates below.'
                )
              }
            />
          )}
          {mapLoadError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/95 px-4 text-sm text-muted-foreground">
              {mapLoadError}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Click the map to set coordinates for a location you want to add.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="privacyHomeLatitude">Latitude</Label>
          <Input
            id="privacyHomeLatitude"
            ref={latitudeInputRef}
            type="text"
            inputMode="decimal"
            placeholder="e.g. 37.774900"
            value={latitudeInput}
            onChange={(event) => {
              setLatitudeInput(event.target.value)
              clearCoordinatesError()
            }}
            onBlur={() => {
              if (!isHydratingSettingsRef.current) {
                flyToMarker()
              }
            }}
            disabled={isEditingDisabled}
            aria-invalid={coordinatesError ? true : undefined}
            aria-describedby={
              coordinatesError ? 'privacy-coordinates-error' : undefined
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="privacyHomeLongitude">Longitude</Label>
          <Input
            id="privacyHomeLongitude"
            ref={longitudeInputRef}
            type="text"
            inputMode="decimal"
            placeholder="e.g. -122.419400"
            value={longitudeInput}
            onChange={(event) => {
              setLongitudeInput(event.target.value)
              clearCoordinatesError()
            }}
            onBlur={() => {
              if (!isHydratingSettingsRef.current) {
                flyToMarker()
              }
            }}
            disabled={isEditingDisabled}
            aria-invalid={coordinatesError ? true : undefined}
            aria-describedby={
              coordinatesError ? 'privacy-coordinates-error' : undefined
            }
          />
        </div>
        {coordinatesError ? (
          <p
            id="privacy-coordinates-error"
            className="text-xs text-destructive-text md:col-span-2"
          >
            {coordinatesError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="privacyHideRadiusMeters">Hide Radius</Label>
        <Select
          id="privacyHideRadiusMeters"
          ref={radiusSelectRef}
          className="h-10"
          value={String(draftRadiusMeters)}
          onChange={(event) => {
            setDraftRadiusMeters(
              sanitizeDraftRadius(Number(event.target.value))
            )
            setFieldError((current) =>
              current?.field === 'radius' ? null : current
            )
          }}
          disabled={isEditingDisabled}
          aria-invalid={radiusError ? true : undefined}
          aria-describedby={radiusError ? 'privacy-radius-error' : undefined}
        >
          {NON_ZERO_RADIUS_OPTIONS.map((radius) => (
            <option key={radius} value={radius}>
              {formatRadiusLabel(radius)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{copy.hideRadiusHelp}</p>
        {radiusError ? (
          <p
            id="privacy-radius-error"
            className="text-xs text-destructive-text"
          >
            {radiusError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={handleUseCurrentLocation}
          disabled={
            isEditingDisabled || isFooterBusy || isLocatingCurrentPosition
          }
        >
          {isLocatingCurrentPosition ? 'Locating…' : 'Use current location'}
        </Button>
        <Button
          variant="outline"
          onClick={handleAddLocation}
          disabled={
            isEditingDisabled || isFooterBusy || isLocatingCurrentPosition
          }
        >
          Add location to list
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Saved Privacy Locations</Label>
        {privacyLocations.length > 0 ? (
          <div className="space-y-2">
            {privacyLocations.map((location, index) => (
              <div
                key={`${location.latitude}-${location.longitude}-${location.hideRadiusMeters}-${index}`}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="pr-3">
                  <p className="text-sm font-medium">
                    {location.latitude.toFixed(6)},{' '}
                    {location.longitude.toFixed(6)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hide radius: {formatRadiusLabel(location.hideRadiusMeters)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemoveLocation(index)}
                  disabled={isEditingDisabled || isFooterBusy}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No privacy locations added yet.
          </p>
        )}
      </div>

      {!isLoading && !hasLoadedSettings ? (
        // Derived from the condition, not stored in `error`, which every
        // action handler clears — the guard below must never be left
        // unexplained.
        <Alert title="Failed to load your saved privacy locations.">
          Editing and saving are disabled so the locations you already have are
          not overwritten.
        </Alert>
      ) : null}
      {error ? <Alert title={error} /> : null}
      {message ? <p className="text-sm text-success-text">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleSave}
          disabled={
            isEditingDisabled || isFooterBusy || isLocatingCurrentPosition
          }
        >
          {isSaving ? 'Saving…' : copy.saveButton}
        </Button>
        <Button
          variant="outline"
          onClick={handleClear}
          disabled={
            isEditingDisabled || isFooterBusy || isLocatingCurrentPosition
          }
        >
          Clear all
        </Button>
        {!isLoading && !hasLoadedSettings ? (
          <Button
            variant="outline"
            onClick={() => setSettingsReloadToken((token) => token + 1)}
          >
            Retry loading
          </Button>
        ) : null}
        {footerContent}
      </div>
    </div>
  )
}
