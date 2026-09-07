'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'
import {
  Activity,
  BarChart3,
  Bike,
  Calendar,
  Clock,
  ExternalLink,
  Flame,
  Footprints,
  Gauge,
  Globe,
  HeartPulse,
  Image as ImageIcon,
  Lock,
  type LucideIcon,
  Mail,
  MessageCircle,
  Mountain,
  Play,
  Plus,
  Route,
  Unlock,
  Watch,
  Wrench
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { formatGearDistanceKm } from '@/app/(timeline)/fitness/gear/gearUi'
import {
  type FitnessRouteSample,
  type FitnessRouteSegment,
  type StatusFitnessFileItem,
  getFitnessFilesByStatus,
  getFitnessGearList,
  getFitnessRouteData,
  updateFitnessFileGear
} from '@/lib/client'
import { ActivityRouteMapKit } from '@/lib/components/fitness/ActivityRouteMapKit'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
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
import { BrandedDeviceLink } from '@/lib/components/posts/BrandedDeviceLink'
import { Actions } from '@/lib/components/posts/actions/actions'
import type { PostMenuExtraItem } from '@/lib/components/posts/actions/post-menu'
import { ActorAvatar } from '@/lib/components/posts/actor'
import { InlineStatusComposer } from '@/lib/components/posts/inline-status-composer'
import { Media } from '@/lib/components/posts/media'
import { Post } from '@/lib/components/posts/post'
import { ReactionRow } from '@/lib/components/posts/reaction-row'
import { RetryFitnessButton } from '@/lib/components/posts/retry-fitness-button'
import { StatusReplyBox } from '@/lib/components/posts/status-reply-box'
import { useInlineComposer } from '@/lib/components/posts/useInlineComposer'
import { useReactionState } from '@/lib/components/posts/useReactionState'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { getGearKindForActivityType } from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import type { FitnessGearKind } from '@/lib/types/database/fitnessGear'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  getFitnessPaceOrSpeed,
  getFitnessSourceLabel,
  normalizeFitnessSourceUrl
} from '@/lib/utils/fitness'
import { getDeviceDisplayLabel } from '@/lib/utils/fitnessDeviceBrands'
import {
  type MastodonVisibility,
  getVisibility
} from '@/lib/utils/getVisibility'
import {
  type PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

import {
  ANALYSIS_GRAPH_OPTIONS,
  type AnalysisGraphKey,
  ElevationProfileChart,
  FitnessAnalysisCharts,
  GRAPH_HEIGHT_CLASSNAME,
  type GraphDisplayMode,
  HeartRateZonesPanel
} from './FitnessAnalysisCharts'
import {
  GRAPH_VIEW_HEIGHT,
  clampNumber,
  computeHeartRateStats,
  computeHeartRateZones,
  computePowerHistogramMinutes,
  fillHeartRateDropouts,
  filterPositiveHeartRateSeries,
  formatDuration,
  getSeriesMinMax,
  plotAtStravaDensity
} from './fitnessChartData'

interface Props {
  host: string
  /** Which map backend renders the activity route map. */
  mapProvider: PublicMapProvider
  currentTime: number
  currentActor?: ActorProfile | null
  status: StatusNote
  replies?: Status[]
  isMediaUploadEnabled?: boolean
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
}

type SectionKey =
  | 'overview'
  | 'analysis'
  | 'heart-rate-zones'
  | '25w-distribution'
  | 'photos'
  | 'comments'

type SectionTab = SectionNavSelectTab<SectionKey>

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

const VISIBILITY_META: Record<
  MastodonVisibility,
  { label: string; icon: LucideIcon }
> = {
  public: { label: 'Public', icon: Globe },
  unlisted: { label: 'Unlisted', icon: Unlock },
  private: { label: 'Followers only', icon: Lock },
  direct: { label: 'Direct', icon: Mail }
}

const formatUtcDate = (timestamp: number, pattern: string) => {
  return format(new UTCDate(timestamp), pattern)
}

const getActivityLabel = (activityType?: string) => {
  if (!activityType) return 'Activity'

  const normalized = activityType.toLowerCase()
  if (normalized.includes('ride') || normalized.includes('bike')) {
    return 'Ride'
  }
  if (normalized.includes('run')) return 'Run'
  if (normalized.includes('walk') || normalized.includes('hike')) return 'Walk'
  if (normalized.includes('swim')) return 'Swim'
  if (normalized.includes('row')) return 'Row'
  if (normalized.includes('yoga') || normalized.includes('pilates')) {
    return 'Yoga'
  }
  if (normalized.includes('climb')) return 'Climb'
  if (normalized.includes('ski') || normalized.includes('snowboard')) {
    return 'Ski'
  }
  if (normalized.includes('skat')) return 'Skate'
  if (normalized.includes('surf')) return 'Surf'
  if (normalized.includes('racket') || normalized.includes('tennis')) {
    return 'Racket'
  }
  if (normalized.includes('martial') || normalized.includes('box')) {
    return 'Martial Arts'
  }
  if (
    normalized.includes('team') ||
    normalized.includes('soccer') ||
    normalized.includes('football')
  ) {
    return 'Team Sports'
  }
  if (
    normalized.includes('train') ||
    normalized.includes('workout') ||
    normalized.includes('weight') ||
    normalized.includes('crossfit') ||
    normalized.includes('gym')
  ) {
    return 'Training'
  }
  if (normalized === 'other') return 'Other'

  return `${activityType[0].toUpperCase()}${activityType.slice(1)}`
}

const MAP_ROUTE_SOURCE_ID = 'activity-route'
const MAP_ROUTE_HIDDEN_HIT_LAYER_ID = 'activity-route-line-hidden-hit'
const MAP_ACTIVE_POINT_SOURCE_ID = 'activity-active-point'
// The interactive map now renders for every provider, so a style/tile failure
// (CDN outage, blocked origin, offline) must still surface the pre-generated
// static preview. `loadModule()` has its own 15s timeout, but once the GL module
// is in memory a failing style simply never fires `load` — hence the watchdog,
// matching RouteHeatmapMap.
const MAP_LOAD_TIMEOUT_MS = 20_000

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
        samples
      }
    ]
  }

  return []
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

const Card: FC<{
  className?: string
  children: ReactNode
  padded?: boolean
}> = ({ className, children, padded = true }) => (
  <div
    className={cn(
      'rounded-xl border bg-card shadow-sm',
      padded && 'p-5',
      className
    )}
  >
    {children}
  </div>
)

const SectionTitle: FC<{
  icon?: LucideIcon
  children: ReactNode
  right?: ReactNode
}> = ({ icon: Icon, children, right }) => (
  <div className="mb-3 flex items-center justify-between gap-2">
    <h2 className="flex items-center gap-2 text-base font-semibold">
      {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      {children}
    </h2>
    {right}
  </div>
)

const StatTile: FC<{
  icon?: LucideIcon
  label: string
  value: string
  sub?: string
  accent?: boolean
  big?: boolean
}> = ({ icon: Icon, label, value, sub, accent = false, big = false }) => (
  <div className="rounded-xl border bg-background p-3.5 shadow-sm">
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {Icon ? <Icon className="size-3.5" /> : null}
      <span className="text-[11px] font-medium uppercase tracking-wide">
        {label}
      </span>
    </div>
    <div
      className={cn(
        'mt-1.5 font-semibold leading-none tracking-tight tabular-nums',
        big ? 'text-[28px]' : 'text-[21px]',
        accent && 'text-primary'
      )}
    >
      {value}
    </div>
    {sub ? (
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    ) : null}
  </div>
)

interface GearPickerOption {
  id: string
  name: string
  kind: FitnessGearKind | null
  distanceMeters: number | null
}

// `Wrench` is the app's own icon for the Gear section (see the fitness layout's
// sub-nav), so it is the honest fallback when neither the assigned gear nor the
// activity type says which kind this is — a free-form GPX `activityType` that
// `normalizeActivityTypeToSportKey` refuses to guess at, most often.
const GEAR_KIND_ICON: Record<FitnessGearKind, LucideIcon> = {
  bike: Bike,
  shoes: Footprints,
  // Never reached through the picker — devices are filtered out of it — but a
  // gear already assigned is always shown whatever it is, and this map is what
  // renders that value.
  device: Watch
}

/**
 * The assigned gear, inline in the header's metadata line. The design system
 * (`FAGearRow` in `ui_kits/web/FitnessActivity.jsx`) reads the recording
 * metadata as one wrapping line — date · visibility · gear — rather than giving
 * gear a labelled field and a row of its own, and makes the gear a LINK to its
 * own page. Changing the assignment is not here at all: it is "Change gear" in
 * the post's ⋯ menu, the way `FAMoreMenu` has it.
 *
 * `/fitness/gear/<id>` is owner-scoped, so only the owner gets the link — the
 * same constraint `BrandedDeviceLink` resolves the same way on the line below.
 * Everyone else gets the name as plain text, and nobody gets anything when no
 * gear is attributed.
 */
const ActivityGearMeta: FC<{
  isOwner: boolean
  /** The id of the gear this activity is attributed to, if any. */
  gearId: string | null
  /** The name the status payload carried, for a viewer with no gear list. */
  gearName: string | null
  /**
   * That gear's lifetime distance, when the owner's shed has been loaded. It
   * rides in the `title` rather than on the line, which is already carrying the
   * date and the visibility.
   */
  distanceMeters: number | null
  /** The kind of the assigned gear, else what the activity type implies. */
  kind: FitnessGearKind | null
}> = ({ isOwner, gearId, gearName, distanceMeters, kind }) => {
  const label = gearName?.trim() || null
  if (!label) return null

  const Icon = kind ? GEAR_KIND_ICON[kind] : Wrench
  const title =
    distanceMeters === null
      ? `Gear: ${label}`
      : `Gear: ${label} · ${formatGearDistanceKm(distanceMeters)}`
  // The icon alone carries the meaning visually; spell it out for a screen
  // reader, which otherwise hears a bare product name.
  const content = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Gear: </span>
      <span className="truncate">{label}</span>
    </>
  )

  return (
    <>
      <span aria-hidden="true">·</span>
      {isOwner && gearId ? (
        <Link
          // One link on a detail page rather than one per feed row, but it
          // points at the same dynamic owner-scoped route the device link
          // beside it does, so it opts out of prefetching for the same reason.
          prefetch={false}
          href={`/fitness/gear/${encodeURIComponent(gearId)}`}
          title={title}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {content}
        </Link>
      ) : (
        <span
          className="inline-flex min-w-0 items-center gap-1.5"
          title={title}
        >
          {content}
        </span>
      )}
    </>
  )
}

const ActivityMapPanel: FC<{
  mapAttachment?: Attachment
  routeSamples: FitnessRouteSample[]
  routeSegments: FitnessRouteSegment[]
  highlightedElapsedSeconds?: number | null
  mapProvider: PublicMapProvider
  routeDataError?: string | null
  isRouteDataLoading?: boolean
  onOpenMap?: () => void
}> = ({
  mapAttachment,
  routeSamples,
  routeSegments,
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
  const drawableRouteSegments = useMemo(
    () => routeSegments.filter((segment) => segment.samples.length >= 2),
    [routeSegments]
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
    return findRouteSampleForElapsed(routeSamples, highlightedElapsedSeconds)
  }, [highlightedElapsedSeconds, routeSamples, shouldRenderInteractiveMap])

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

  return (
    <div className="relative h-72 overflow-hidden rounded-lg border bg-muted">
      {shouldRenderInteractiveMap && !glProvider ? (
        <ActivityRouteMapKit
          routeSegments={drawableRouteSegments}
          routeSamples={routeSamples}
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

const ActivityGallery: FC<{
  attachments: Attachment[]
  onOpenAttachment: (index: number) => void
}> = ({ attachments, onOpenAttachment }) => {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {attachments.map((attachment, index) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onOpenAttachment(index)}
          className="relative aspect-video overflow-hidden rounded-md border transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          aria-label={`Open media ${index + 1}`}
        >
          <Media
            attachment={attachment}
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  )
}

/**
 * The source-file row in the card footer. `href` is set only for the owner:
 * `GET /api/v1/fitness-files/:id` serves the original upload, which still holds
 * the ends a privacy location trims off the map and the route data, so it is
 * owner-only and a link shown to anyone else would only 404.
 *
 * The row itself is not gated — the file name is the label saying which file the
 * panel is describing, and with several attached it is what the selector
 * switches between. Only the download goes.
 */
const SourceFileRow: FC<{
  href?: string
  fileName: string
  fileType: string
  position: string | null
}> = ({ href, fileName, fileType, position }) => {
  const content = (
    <>
      <Activity className="size-3.5 shrink-0" />
      <span
        className={cn(
          'truncate',
          href && 'underline decoration-border underline-offset-2'
        )}
      >
        {fileName}
      </span>
      <span className="shrink-0 uppercase">{fileType}</span>
      {position ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          {position}
        </span>
      ) : null}
    </>
  )
  const className =
    'inline-flex min-w-0 items-center gap-2 self-start text-xs text-muted-foreground'

  if (!href) {
    return (
      <div className={className} title={fileName}>
        {content}
      </div>
    )
  }

  return (
    <a href={href} className={className} title={fileName}>
      {content}
    </a>
  )
}

export const FitnessStatusDetail: FC<Props> = ({
  host,
  mapProvider,
  currentTime,
  currentActor,
  status,
  replies = [],
  isMediaUploadEnabled,
  onShowAttachment
}) => {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<SectionKey>('overview')
  // `separate` (the default) stacks each selected graph into its own row; the new
  // `combined` option overlays them in one chart.
  const [graphDisplayMode, setGraphDisplayMode] =
    useState<GraphDisplayMode>('separate')
  // Which series are drawn, as a multi-select. Every graph starts on, so the
  // default view is every available series (a key with no data is filtered out
  // downstream), and the picker chips toggle each on and off. Intersecting this
  // intent with the series that actually have data is what lets it stay stable
  // as the selected file changes underneath it.
  const [selectedGraphKeys, setSelectedGraphKeys] = useState<
    AnalysisGraphKey[]
  >(() => ANALYSIS_GRAPH_OPTIONS.map((option) => option.id))
  const toggleGraphKey = (key: AnalysisGraphKey) =>
    setSelectedGraphKeys((previous) =>
      previous.includes(key)
        ? previous.filter((selected) => selected !== key)
        : [...previous, key]
    )
  // Force-resets the always-on comment composer after a cancel or a post.
  const [composerKey, setComposerKey] = useState(0)
  // Edit and quote open the same inline composer every other surface uses, so
  // a fitness activity is editable from its own page exactly as it is from the
  // timeline. Reply is not routed through it here: this page has an always-on
  // composer in its Comments section, which the reply action jumps to instead.
  const composer = useInlineComposer()
  // This page lays out its own card, so it holds the reaction rollups the way
  // `Post` does — the chip row in the card body and the picker trigger in the
  // shared `Actions` row below both read this one state.
  const reactionState = useReactionState({
    currentActor: currentActor ?? undefined,
    status
  })

  // Hoisted above the effects below: the gear list is owner-only, so the effect
  // that loads it needs this before it runs.
  const isOwner =
    Boolean(status.isLocalActor) && currentActor?.id === status.actorId

  const defaultFitnessFiles = useMemo<StatusFitnessFileItem[]>(() => {
    if (!status.fitness) {
      return []
    }

    return [
      {
        id: status.fitness.id,
        actorId: status.actorId,
        fileName: status.fitness.fileName,
        fileType: status.fitness.fileType,
        statusId: status.id,
        isPrimary: true,
        processingStatus: status.fitness.processingStatus ?? 'pending',
        totalDistanceMeters: status.fitness.totalDistanceMeters ?? null,
        totalDurationSeconds: status.fitness.totalDurationSeconds ?? null,
        movingTimeSeconds: status.fitness.movingTimeSeconds ?? null,
        elevationGainMeters: status.fitness.elevationGainMeters ?? null,
        activityType: status.fitness.activityType ?? null,
        // Must come off the payload, not from `status.createdAt`: a Strava
        // webhook import is stamped when it published rather than when the ride
        // began, so a post-time stand-in dates the activity wrongly until the
        // by-status fetch below replaces this placeholder. The `??` arm is only
        // a shape default — the single fallback that actually renders is the one
        // on `activityDate` further down, which this deliberately mirrors rather
        // than pre-empts.
        activityStartTime: status.fitness.activityStartTime ?? status.createdAt,
        hasMapData: status.fitness.hasMapData ?? false,
        description: status.fitness.description ?? null,
        deviceManufacturer: status.fitness.deviceManufacturer ?? null,
        deviceName: status.fitness.deviceName ?? null,
        sourceUrl: status.fitness.sourceUrl ?? null,
        gearId: status.fitness.gearId ?? null,
        gearName: status.fitness.gearName ?? null,
        deviceGearId: status.fitness.deviceGearId ?? null,
        deviceGearName: status.fitness.deviceGearName ?? null
      }
    ]
  }, [
    status.actorId,
    status.createdAt,
    status.id,
    status.fitness?.id,
    status.fitness?.fileName,
    status.fitness?.fileType,
    status.fitness?.processingStatus,
    status.fitness?.totalDistanceMeters,
    status.fitness?.totalDurationSeconds,
    status.fitness?.movingTimeSeconds,
    status.fitness?.elevationGainMeters,
    status.fitness?.activityType,
    status.fitness?.activityStartTime,
    status.fitness?.hasMapData,
    status.fitness?.description,
    status.fitness?.deviceManufacturer,
    status.fitness?.deviceName,
    status.fitness?.sourceUrl,
    status.fitness?.gearId,
    status.fitness?.gearName
  ])
  const [fitnessFiles, setFitnessFiles] =
    useState<StatusFitnessFileItem[]>(defaultFitnessFiles)
  const [selectedFitnessFileId, setSelectedFitnessFileId] = useState<
    string | null
  >(defaultFitnessFiles[0]?.id ?? null)
  const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
    null
  )
  const [gearOptions, setGearOptions] = useState<GearEntity[]>([])
  // Keyed by file, not a single slot. An activity can aggregate several files
  // and the switcher stays enabled during a PATCH, so a failure that lands after
  // the reader has moved on must not render as the NEXT file's error — that
  // would wire `aria-describedby` from that file's picker to a message about a
  // different one. One slot was not enough either: whichever file failed second
  // would evict the first, and the first was invisible at the time precisely
  // because its reader had moved on, so nobody would ever have seen it.
  const [gearUpdateErrors, setGearUpdateErrors] = useState<
    Record<string, string>
  >({})
  const [isSavingGear, setIsSavingGear] = useState(false)
  const [routeSamples, setRouteSamples] = useState<FitnessRouteSample[]>([])
  const [routeSegments, setRouteSegments] = useState<FitnessRouteSegment[]>([])
  const [powerSeries, setPowerSeries] = useState<number[]>([])
  const [heartRateSeries, setHeartRateSeries] = useState<number[]>([])
  const [altitudeSeries, setAltitudeSeries] = useState<number[]>([])
  const [speedSeries, setSpeedSeries] = useState<number[]>([])
  const [routeDataError, setRouteDataError] = useState<string | null>(null)
  const [isRouteDataLoading, setIsRouteDataLoading] = useState(false)
  const [highlightedElapsedSeconds, setHighlightedElapsedSeconds] = useState<
    number | null
  >(null)

  useEffect(() => {
    setFitnessFiles(defaultFitnessFiles)
    setSelectedFitnessFileId(defaultFitnessFiles[0]?.id ?? null)
  }, [defaultFitnessFiles])

  useEffect(() => {
    let cancelled = false

    const loadFitnessFiles = async () => {
      try {
        const files = await getFitnessFilesByStatus(status.id)
        if (cancelled || !files || files.length === 0) return

        const ordered = [...files].sort((first, second) => {
          const firstStart = first.activityStartTime ?? Number.MAX_SAFE_INTEGER
          const secondStart =
            second.activityStartTime ?? Number.MAX_SAFE_INTEGER

          if (firstStart !== secondStart) {
            return firstStart - secondStart
          }

          if (first.fileName !== second.fileName) {
            return first.fileName.localeCompare(second.fileName)
          }

          return first.id.localeCompare(second.id)
        })

        setFitnessFiles(ordered)
        setSelectedFitnessFileId((current) => {
          if (current && ordered.some((item) => item.id === current)) {
            return current
          }
          return ordered.find((item) => item.isPrimary)?.id ?? ordered[0].id
        })
      } catch {
        // Keep the status payload fallback if the list endpoint is unavailable.
      }
    }

    void loadFitnessFiles()

    return () => {
      cancelled = true
    }
  }, [status.id])

  // Owner only — /api/v1/fitness/gear is the owner's shed, and a viewer has no
  // use for it. A failure leaves the list empty, which degrades the picker to
  // the read-only gear row rather than breaking the page.
  useEffect(() => {
    if (!isOwner) return

    let cancelled = false

    const loadGear = async () => {
      try {
        const gear = await getFitnessGearList()
        if (cancelled) return
        setGearOptions(gear)
      } catch {
        // Keep the read-only presentation when the gear list is unavailable.
      }
    }

    void loadGear()

    return () => {
      cancelled = true
    }
  }, [isOwner])

  const actorName = status.actor?.name || status.actor?.username || 'Athlete'
  const actorHandle = status.actor ? getMention(status.actor, true) : null
  const fitness = useMemo(
    () =>
      fitnessFiles.find((item) => item.id === selectedFitnessFileId) ??
      fitnessFiles[0],
    [fitnessFiles, selectedFitnessFileId]
  )
  const selectedFileIndex = useMemo(
    () => fitnessFiles.findIndex((item) => item.id === fitness?.id),
    [fitnessFiles, fitness?.id]
  )
  const selectedGearId = fitness?.gearId ?? null
  // Options for the owner's gear picker. Retired gear is out (it is still
  // *assignable* through the API — see `setFitnessFileGear` — but it does not
  // belong in a picker for a fresh activity), and the list narrows to the kind
  // the activity implies. An unrecognised activity type narrows to nothing:
  // `getGearKindForActivityType` is a convenience, never a permission.
  //
  // Whatever is currently assigned is ALWAYS in the list, even when the kind
  // filter or its retirement would drop it — a picker that cannot represent its
  // own value renders the assignment as something else, which reads as the gear
  // having changed on its own. The last fallback covers the gear list failing to
  // load at all, using the name the status payload carried.
  const gearPickerOptions = useMemo<GearPickerOption[]>(() => {
    const kind = getGearKindForActivityType(fitness?.activityType)
    // Devices are excluded BEFORE the kind narrowing, not by it: an
    // unrecognised activity type narrows to nothing and offers every active
    // gear, which would put the head unit that recorded the ride in the list of
    // things the ride could have been done on.
    const active = gearOptions.filter(
      (gear) => gear.retiredAt === null && gear.kind !== 'device'
    )
    const options = (
      kind ? active.filter((gear) => gear.kind === kind) : active
    ).map((gear) => ({
      id: gear.id,
      name: gear.name,
      kind: gear.kind,
      distanceMeters: gear.distanceMeters
    }))

    if (!selectedGearId || options.some((item) => item.id === selectedGearId)) {
      return options
    }

    const assigned = gearOptions.find((gear) => gear.id === selectedGearId)
    return [
      {
        id: selectedGearId,
        name: assigned?.name ?? fitness?.gearName ?? 'Assigned gear',
        kind: assigned?.kind ?? null,
        distanceMeters: assigned?.distanceMeters ?? null
      },
      ...options
    ]
  }, [gearOptions, fitness?.activityType, fitness?.gearName, selectedGearId])

  // Whatever is assigned is always in `gearPickerOptions` when the shed has
  // loaded, so this is where the metadata line's link gets its kind icon and
  // its lifetime distance. Undefined for a viewer (who never loads the shed)
  // and for an owner whose shed failed to load, both of which fall back to the
  // activity type's kind and no distance.
  const assignedGear = selectedGearId
    ? gearPickerOptions.find((option) => option.id === selectedGearId)
    : undefined

  // Only ever the error for the file on screen; a failure that lands after the
  // reader switched files stays with the file it happened to, and comes back
  // with it.
  const gearErrorMessage = fitness?.id
    ? (gearUpdateErrors[fitness.id] ?? null)
    : null

  const handleGearChange = async (value: string) => {
    const fitnessFileId = fitness?.id
    if (!fitnessFileId) return
    // Re-picking what is already assigned is not a change. A `<select>` never
    // fired `onChange` for that, but every row of a menu fires `onSelect`, and
    // tapping the checked row to dismiss the menu is the natural gesture — it
    // would otherwise PATCH, re-evaluate the service reminders, and on a network
    // hiccup show an error for a change the owner never made.
    if (value === (selectedGearId ?? '')) return

    const nextGearId = value || null
    const nextGearName = nextGearId
      ? (gearPickerOptions.find((item) => item.id === nextGearId)?.name ?? null)
      : null
    // Only this file's assignment is rolled back, and only through an updater:
    // restoring a whole array captured from this render would also discard
    // anything the `getFitnessFilesByStatus` effect (or a sibling file's own
    // change) wrote while the PATCH was in flight.
    const previousGearId = fitness?.gearId ?? null
    const previousGearName = fitness?.gearName ?? null

    // Drops only this file's own error. A reset that reached the whole map
    // would discard a sibling file's pending failure, and because that one was
    // hidden while its reader was on another file, they would never have seen
    // it — the gear silently back to what it was, with nothing saying why.
    setGearUpdateErrors((current) => {
      if (!(fitnessFileId in current)) return current
      const { [fitnessFileId]: _cleared, ...rest } = current
      return rest
    })
    setIsSavingGear(true)
    setFitnessFiles((files) =>
      files.map((file) =>
        file.id === fitnessFileId
          ? { ...file, gearId: nextGearId, gearName: nextGearName }
          : file
      )
    )

    try {
      await updateFitnessFileGear(fitnessFileId, nextGearId)
    } catch (error) {
      // Put the previous assignment back rather than leaving the select showing
      // a value the server never accepted.
      setFitnessFiles((files) =>
        files.map((file) =>
          file.id === fitnessFileId
            ? { ...file, gearId: previousGearId, gearName: previousGearName }
            : file
        )
      )
      setGearUpdateErrors((current) => ({
        ...current,
        [fitnessFileId]:
          error instanceof Error ? error.message : 'Failed to update gear.'
      }))
    } finally {
      setIsSavingGear(false)
    }
  }

  // Changing the assignment is an item in the post's own ⋯ menu, the way the
  // design system's `FAMoreMenu` has it — the metadata line's gear is a link to
  // the gear page, not a control. Absent entirely when there is nothing to pick
  // (`FAMoreMenu`'s own `if (!canChange) return null`): a submenu whose only
  // entry is "No gear" is dead UI, the same rule that kept the old picker off
  // an empty shed.
  //
  // Not memoized on purpose: it closes over `handleGearChange`, which is rebuilt
  // every render anyway, so a `useMemo` here would only be able to hand back a
  // stale one.
  const gearMenuItems: PostMenuExtraItem[] =
    isOwner && gearPickerOptions.length > 0
      ? [
          {
            key: 'change-gear',
            icon: <Wrench className="size-4" />,
            label: 'Change gear',
            // Two quick changes otherwise race, and the loser's rollback would
            // put back a value the server has since replaced. On the trigger as
            // well as the rows, so the submenu cannot even be opened mid-write.
            disabled: isSavingGear,
            items: [
              ...gearPickerOptions.map((option) => ({
                key: option.id,
                label: option.name,
                checked: option.id === selectedGearId,
                // The lifetime total, as the design shows it — it is what tells
                // two similar bikes apart at a glance. Absent on a gear the
                // list never returned.
                trailing:
                  typeof option.distanceMeters === 'number'
                    ? formatGearDistanceKm(option.distanceMeters)
                    : undefined,
                disabled: isSavingGear,
                onSelect: () => void handleGearChange(option.id)
              })),
              {
                key: 'no-gear',
                label: 'No gear',
                checked: selectedGearId === null,
                muted: true,
                disabled: isSavingGear,
                onSelect: () => void handleGearChange('')
              }
            ]
          }
        ]
      : []

  // Every provider renders an interactive map, so route data is loaded whenever
  // there is a fitness file to load it from.
  const shouldLoadInteractiveMap = Boolean(fitness?.id)
  const activityLabel = getActivityLabel(fitness?.activityType ?? undefined)
  // Render the caption through the same pipeline `Post` uses (markdown/sanitize
  // + emoji/mention/hashtag markup, parsed to React nodes), rather than
  // flattening `status.text` to plain text for a synthetic heading. That
  // previous plain-text heading dropped every tag from the caption — including
  // its own `<p>`/`<br>` line breaks, which ran every paragraph onto one line —
  // so this caption now looks exactly like the same post's caption in the
  // timeline. Memoized because this re-parses HTML and the component re-renders
  // frequently (e.g. on chart hover).
  const caption = useMemo(
    () => cleanClassName(processStatusText(host, status)),
    [host, status]
  )
  const activityDate = formatUtcDate(
    fitness?.activityStartTime ?? status.createdAt,
    'p, MMMM d, yyyy'
  )
  const visibilityMeta =
    VISIBILITY_META[getVisibility(status.to, status.cc)] ??
    VISIBILITY_META.public
  const VisibilityIcon = visibilityMeta.icon
  // The gear row's name overrides the recorded one, so this renders whenever
  // EITHER is present — a device renamed to something the brand map cannot
  // resolve would otherwise vanish from the page.
  const deviceLabel =
    fitness?.deviceGearName?.trim() ||
    getDeviceDisplayLabel(fitness?.deviceName, fitness?.deviceManufacturer)

  const paceOrSpeed = getFitnessPaceOrSpeed({
    distanceMeters: fitness?.totalDistanceMeters ?? undefined,
    durationSeconds: fitness?.totalDurationSeconds ?? undefined,
    movingTimeSeconds: fitness?.movingTimeSeconds ?? undefined,
    activityType: fitness?.activityType ?? undefined
  })
  const fitnessSourceUrl = normalizeFitnessSourceUrl(fitness?.sourceUrl)

  const mapAttachmentIndex = useMemo(() => {
    const routeMapIndex = status.attachments.findIndex((attachment) =>
      attachment.name.toLowerCase().includes('route map')
    )

    if (routeMapIndex >= 0) return routeMapIndex
    if (fitness?.hasMapData && status.attachments.length > 0) return 0
    return -1
  }, [fitness?.hasMapData, status.attachments])

  const mapAttachment =
    mapAttachmentIndex >= 0 ? status.attachments[mapAttachmentIndex] : undefined

  const shouldRenderMapPanel =
    !!mapAttachment ||
    fitness?.hasMapData ||
    (shouldLoadInteractiveMap &&
      (isRouteDataLoading || routeSegments.length > 0))

  const mediaWithoutMap = useMemo(
    () => status.attachments.filter((_, index) => index !== mapAttachmentIndex),
    [mapAttachmentIndex, status.attachments]
  )

  useEffect(() => {
    setRouteSamples([])
    setRouteSegments([])
    setPowerSeries([])
    setHeartRateSeries([])
    setAltitudeSeries([])
    setSpeedSeries([])
    setRouteDataError(null)

    if (!fitness?.id) {
      setIsRouteDataLoading(false)
      return
    }

    let cancelled = false

    const loadRouteSamples = async () => {
      try {
        setIsRouteDataLoading(true)

        const data = await getFitnessRouteData(fitness.id)

        if (cancelled) return

        const normalizedSamples = data.samples.map((sample) =>
          normalizeRouteSample(sample)
        )
        const normalizedSegments = normalizeRouteSegments({
          samples: normalizedSamples,
          segments: data.segments
        })

        setRouteSamples(normalizedSamples)
        setRouteSegments(normalizedSegments)
        setPowerSeries(data.powerSeries ?? [])
        setHeartRateSeries(data.heartRateSeries ?? [])
        setAltitudeSeries(data.altitudeSeries ?? [])
        setSpeedSeries(data.speedSeries ?? [])
      } catch (_error) {
        if (cancelled) return
        setRouteSamples([])
        setRouteSegments([])
        setPowerSeries([])
        setHeartRateSeries([])
        setAltitudeSeries([])
        setSpeedSeries([])
        setRouteDataError(
          'Could not load route and analysis data for this activity.'
        )
      } finally {
        if (!cancelled) {
          setIsRouteDataLoading(false)
        }
      }
    }

    void loadRouteSamples()

    return () => {
      cancelled = true
    }
  }, [fitness?.id])

  // Both Overview (its elevation profile) and Analysis (its graph stack) scrub
  // the same instant onto the same map, so leaving a section always drops the
  // highlight: the pointer is no longer over any chart, and a crosshair left
  // standing on a section you have just switched away from reads as a fault.
  useEffect(() => {
    setHighlightedElapsedSeconds(null)
  }, [activeSection])

  const distanceMeters = fitness?.totalDistanceMeters ?? 0
  const durationSeconds = fitness?.totalDurationSeconds ?? 0
  const elevationGainMeters = fitness?.elevationGainMeters ?? 0
  const distanceKm = distanceMeters > 0 ? distanceMeters / 1000 : 0
  const distanceValue =
    distanceKm >= 10 ? distanceKm.toFixed(1) : distanceKm.toFixed(2)

  const avgPower = useMemo(() => {
    if (powerSeries.length === 0) return null
    return Math.round(
      powerSeries.reduce((a, b) => a + b, 0) / powerSeries.length
    )
  }, [powerSeries])

  const maxPower = useMemo(() => {
    if (powerSeries.length === 0) return null
    return Math.round(getSeriesMinMax(powerSeries).maxValue)
  }, [powerSeries])

  const totalWorkKj = useMemo(() => {
    // 0 W is a valid average (e.g. a fully-coasting segment), so only treat a
    // genuinely-absent power series (null) as "no total work".
    if (avgPower === null || durationSeconds <= 0) return null
    return Math.round((avgPower * durationSeconds) / 1000)
  }, [avgPower, durationSeconds])

  // Heart-rate monitors report 0 bpm during sensor dropouts; exclude those from
  // the avg/max and the zone buckets, which are order-free tallies (unlike
  // power, 0 bpm is never a real reading). Mirrors computeHeartRateZones.
  const positiveHeartRateSeries = useMemo(
    () => filterPositiveHeartRateSeries(heartRateSeries),
    [heartRateSeries]
  )

  // The Analysis chart cannot use that filtered array: it maps sample INDEX to
  // elapsed time positionally, so dropping samples slides the whole heart-rate
  // axis left and the readout reports the wrong instant — a strap that takes
  // ten minutes of a thirty-minute ride to pick up would put the halfway
  // crosshair on the reading recorded at 20:00, with the other three graphs
  // beside it correctly on 15:00 and nothing on screen to say so. Hold the last
  // good reading across a gap instead (back-filling a leading one), which keeps
  // the length and still keeps 0 bpm off the plot.
  const heartRateChartSeries = useMemo(
    () => fillHeartRateDropouts(heartRateSeries),
    [heartRateSeries]
  )

  const heartRateStats = useMemo(
    () => computeHeartRateStats(positiveHeartRateSeries),
    [positiveHeartRateSeries]
  )

  const heartRateZones = useMemo(
    () => computeHeartRateZones(positiveHeartRateSeries, durationSeconds),
    [positiveHeartRateSeries, durationSeconds]
  )

  const activitySeries = useMemo(() => {
    return {
      heartRate: plotAtStravaDensity(heartRateChartSeries),
      power: plotAtStravaDensity(powerSeries),
      speed: plotAtStravaDensity(speedSeries),
      elevation: plotAtStravaDensity(altitudeSeries)
    }
  }, [heartRateChartSeries, powerSeries, speedSeries, altitudeSeries])
  const highlightedElapsedLabel =
    typeof highlightedElapsedSeconds === 'number'
      ? formatDuration(Math.round(highlightedElapsedSeconds))
      : null

  const histogramMinutes = useMemo(
    () => computePowerHistogramMinutes(powerSeries),
    [powerSeries]
  )

  const histogramLayout = useMemo(() => {
    const histogramViewHeight = GRAPH_VIEW_HEIGHT
    const histogramTopPadding = 24 // More padding for the average power label
    const histogramHeight = histogramViewHeight - histogramTopPadding
    const barCount = histogramMinutes.length
    const barGap = 2
    const totalGaps = (barCount - 1) * barGap
    const barWidth = (760 - totalGaps) / Math.max(1, barCount)
    const maxValue = Math.max(...histogramMinutes, 1)

    // Calculate weighted average line position
    const weightedAvgPowerValue = avgPower ?? 0
    const weightedAvgX = (weightedAvgPowerValue / 25) * (barWidth + barGap)

    // Y-axis grid lines (4 intervals)
    const yAxisTicks = Array.from({ length: 5 }, (_, i) => {
      const valueMinutes = (maxValue / 4) * i
      const y =
        histogramViewHeight - (valueMinutes / maxValue) * histogramHeight
      return {
        y,
        label:
          valueMinutes === 0
            ? '0s'
            : formatDuration(Math.round(valueMinutes * 60))
      }
    })

    return {
      histogramViewHeight,
      histogramTopPadding,
      histogramHeight,
      barCount,
      barGap,
      barWidth,
      maxValue,
      weightedAvgPowerValue,
      weightedAvgX,
      yAxisTicks
    }
  }, [avgPower, histogramMinutes])

  const getBarColor = (index: number, total: number) => {
    const ratio = index / Math.max(1, total - 1)
    // Interpolate between light pink (#f4e6ec) and dark purple (#804374)
    const r1 = 244,
      g1 = 230,
      b1 = 236
    const r2 = 128,
      g2 = 67,
      b2 = 116
    const r = Math.round(r1 + (r2 - r1) * ratio)
    const g = Math.round(g1 + (g2 - g1) * ratio)
    const b = Math.round(b1 + (b2 - b1) * ratio)
    return `rgb(${r}, ${g}, ${b})`
  }

  const hasHeartRate = positiveHeartRateSeries.length > 0
  const hasPower = powerSeries.length > 0
  const hasPhotos = mediaWithoutMap.length > 0
  const hasComments = replies.length > 0 || Boolean(currentActor)

  const tabs = useMemo<SectionTab[]>(() => {
    const items: SectionTab[] = [
      { id: 'overview', label: 'Overview', icon: Activity },
      { id: 'analysis', label: 'Analysis', icon: BarChart3 }
    ]
    if (hasHeartRate) {
      items.push({
        id: 'heart-rate-zones',
        label: 'Heart rate zones',
        icon: HeartPulse
      })
    }
    if (hasPower) {
      items.push({
        id: '25w-distribution',
        label: '25 W Distribution',
        icon: Gauge
      })
    }
    if (hasPhotos) {
      items.push({ id: 'photos', label: 'Photos', icon: ImageIcon })
    }
    if (hasComments) {
      items.push({ id: 'comments', label: 'Comments', icon: MessageCircle })
    }
    return items
  }, [hasHeartRate, hasPower, hasPhotos, hasComments])

  // Fall back to Overview if the active section's data went away (e.g. the
  // selected file has no heart-rate series, so the zones tab is dropped).
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeSection)) {
      setActiveSection('overview')
    }
  }, [tabs, activeSection])

  // Owner only, matching the endpoint: the raw upload carries the whole track,
  // including the ends a privacy location trims off the map and the route data,
  // so `GET /api/v1/fitness-files/:id` now 404s for everyone else and a link
  // offered to them would only ever 404.
  //
  // The file NAME still shows: it is the label identifying which file this panel
  // is describing, the same one `Post` puts at the head of its fitness card, and
  // it is what the multi-file selector switches between. Only the download goes.
  const sourceHref =
    isOwner && fitness?.id
      ? `/api/v1/fitness-files/${encodeURIComponent(fitness.id)}`
      : undefined

  const secondaryStats: Array<{
    icon: LucideIcon
    label: string
    value: string
    sub?: string
  }> = []
  if (heartRateStats) {
    secondaryStats.push({
      icon: HeartPulse,
      label: 'Avg HR',
      value: `${heartRateStats.avg}`,
      sub: `max ${heartRateStats.max} bpm`
    })
  }
  if (totalWorkKj !== null) {
    secondaryStats.push({
      icon: Flame,
      label: 'Total work',
      value: `${totalWorkKj}`,
      sub: 'kJ'
    })
  }
  if (maxPower !== null) {
    secondaryStats.push({
      icon: Gauge,
      label: 'Max power',
      value: `${maxPower}`,
      sub: 'watts'
    })
  }
  // Only surface Elevation here when the header's 4th primary tile is Avg power
  // (rides). For runs the header already shows "Elev gain", so repeating it as a
  // secondary tile would duplicate the same number.
  if (avgPower !== null) {
    secondaryStats.push({
      icon: Mountain,
      label: 'Elevation',
      value: `${Math.max(0, Math.round(elevationGainMeters))} m`,
      sub: 'total ascent'
    })
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* Header card */}
      {/* No `overflow-hidden`: this card ends with the shared `<Actions>` row,
          and the row's error tooltips and its edit-history panel are the
          overlays that do NOT portal, so a clip here is a clip on both.

          The tooltips hang `top-full mt-1` under whatever they are anchored to
          — each button's own `relative` span for `ActionButtonError`, the ⋯
          wrapper for `PostMenu`'s error, and the row itself for the compact
          `ActionRowErrors` — and the row is the last child of the footer's
          `py-2.5`, so all three land at the same height. Measured on the
          running page, an anchored tooltip runs y473→515 against a card ending
          at 484: 11 of 42px survived, which reads as nothing happening at all.
          Not a *delete* failure, though — that one goes through the portalled
          confirm dialog. It is the like, bookmark and reaction buttons (reply
          and repost render no error at all), plus `PostMenu`'s non-dialog
          actions (copy link, visibility, quote policy, unmute, unblock), and
          none of those tooltips has a responsive variant, so this half was
          clipped at every breakpoint.

          The edit-history panel opens *upward* from the same row
          (`bottom-full`, ~360px — a 2.5rem header over a `max-h-80` list) over
          a card body only ~230px tall, so the card's top border cut off the
          panel's own header, its close button and its newest revisions (the
          list is newest-first). That half is desktop-only: the panel is
          `max-md:fixed`.

          Only the ⋯ menu's *popover* and the reaction picker are unaffected
          either way — those two portal to the document body. This is the same
          defect class #1369 fixed on the sibling conversation card, and the
          fitness page's own outer card in `page.tsx` had to drop its clip too:
          the like button's tooltip — the leftmost one that renders — starts
          left of this card as well as below it.

          Nothing has to round itself in compensation: this card paints the only
          background in the subtree that reaches its corners — neither the `p-5`
          body nor the footer strip paints one of its own — so give either of
          them a background and it will need `rounded-t-xl`/`rounded-b-xl` to
          stop the square fill bleeding past the border. Nothing inside is
          `position: sticky` either, so no descendant loses a scrollport here. */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="shrink-0">
              <ActorAvatar
                actor={status.actor}
                actorId={status.actorId}
                statusUrl={status.url}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{actorName}</div>
              {actorHandle ? (
                <div className="truncate text-xs text-muted-foreground">
                  {actorHandle}
                </div>
              ) : null}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Activity className="size-3.5" /> {activityLabel}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" /> {activityDate}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className="inline-flex items-center gap-1.5"
              title={visibilityMeta.label}
            >
              <VisibilityIcon className="size-3.5" /> {visibilityMeta.label}
            </span>
            {/* Gear rides on the same line as the rest of the recording
                metadata, the way the design system's header does: the device is
                what captured the activity, the gear is what it was done on.
                Its kind comes from the assigned gear when the owner's shed has
                loaded, and otherwise from what the activity type implies — a
                viewer never loads the shed, so that fallback is all they get. */}
            <ActivityGearMeta
              isOwner={isOwner}
              gearId={selectedGearId}
              gearName={fitness?.gearName ?? null}
              distanceMeters={assignedGear?.distanceMeters ?? null}
              kind={
                assignedGear?.kind ??
                getGearKindForActivityType(fitness?.activityType)
              }
            />
          </div>

          {gearErrorMessage ? (
            <p
              id="activity-gear-error"
              className="mt-1 text-xs text-destructive"
              role="alert"
            >
              {gearErrorMessage}
            </p>
          ) : null}

          {deviceLabel ? (
            <div className="mt-1 text-sm text-muted-foreground">
              Recorded with{' '}
              <BrandedDeviceLink
                deviceName={fitness?.deviceName}
                deviceManufacturer={fitness?.deviceManufacturer}
                deviceGearId={fitness?.deviceGearId}
                deviceGearName={fitness?.deviceGearName}
                isOwner={isOwner}
              />
            </div>
          ) : null}

          {fitnessSourceUrl ? (
            <div className="mt-1 text-sm">
              <a
                href={fitnessSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                {getFitnessSourceLabel(fitnessSourceUrl)}
              </a>
            </div>
          ) : null}

          {/* Design system order: the caption sits after the date/device
              metadata, right before the file switcher and stat grid — not
              immediately under the header row. */}
          <div className="mt-3 text-sm leading-relaxed break-words markdown-content">
            {caption}
          </div>

          {fitnessFiles.length > 1 && (
            <div className="mt-4">
              <label
                htmlFor="activity-file-select"
                className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Activity file
              </label>
              <div className="mt-1.5">
                <select
                  id="activity-file-select"
                  value={selectedFitnessFileId ?? ''}
                  // No need to clear the gear error here — it is keyed to its
                  // own file, so switching hides it and switching back brings it
                  // back, which is what actually happened.
                  onChange={(event) =>
                    setSelectedFitnessFileId(event.target.value)
                  }
                  className="h-9 rounded-lg border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {fitnessFiles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fileName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <FitnessStatGrid className="mt-4">
            <StatTile
              icon={Route}
              label="Distance"
              value={distanceValue}
              sub="km"
              big
            />
            <StatTile
              icon={Clock}
              label="Moving time"
              value={formatDuration(durationSeconds)}
              sub="moving"
              big
            />
            <StatTile
              icon={Gauge}
              label={paceOrSpeed?.label ?? 'Avg speed'}
              value={paceOrSpeed?.value ?? '0.0 km/h'}
              big
              accent
            />
            {avgPower !== null ? (
              <StatTile
                icon={Gauge}
                label="Avg power"
                value={`${avgPower}`}
                sub="watts"
                big
              />
            ) : (
              <StatTile
                icon={Mountain}
                label="Elev gain"
                value={`${Math.max(0, Math.round(elevationGainMeters))}`}
                sub="m"
                big
              />
            )}
          </FitnessStatGrid>

          {/* Reactions belong to the post, so the chips sit inside the card body
              directly under the stats, the way `Post` puts them directly under
              its content. This page lays out its own card rather than going
              through `Posts`, so both halves — the chips here and the picker
              trigger in the action row below — have to be placed explicitly;
              without them a fitness post is the one surface where an existing
              reaction is invisible and no new one can be added. */}
          {reactionState.reactions.length > 0 && (
            // The gate is on the wrapper, not just on `ReactionRow`: the row
            // renders nothing of its own on an unreacted post, so an ungated
            // wrapper would leave dead space under the stat grid.
            <div data-testid="reaction-chips">
              <ReactionRow state={reactionState} />
            </div>
          )}
        </div>

        {/* Deliberately keyed on the file EXISTING, not on the owner-gated
            `sourceHref`: this strip also carries the action row, and on a
            fitness post `fitness?.id` is always set, so the old
            `sourceHref || currentActor` was always true. Gating it on ownership
            instead would take the actions away from every logged-out viewer. */}
        {(fitness?.id || currentActor) && (
          <div className="flex flex-col gap-2 border-t px-4 py-2.5">
            {/* Same row either way — only the owner gets it as a download. The
                underline is the affordance, so it goes with the href rather than
                leaving a non-owner something that looks clickable. */}
            {fitness?.id ? (
              <SourceFileRow
                href={sourceHref}
                fileName={fitness.fileName}
                fileType={fitness.fileType}
                position={
                  fitnessFiles.length > 1 && selectedFileIndex >= 0
                    ? `file ${selectedFileIndex + 1} of ${fitnessFiles.length}`
                    : null
                }
              />
            ) : null}
            {/* The shared action row, not a local copy of it: a post offers the
                same actions with the same spacing on every surface — packed at
                the left edge with ⋯ pushed to the right — and a hand-rolled row
                here is exactly how this page previously drifted into a
                right-packed cluster with gaps of its own. `fullBleed` off
                because the card footer's own padding already puts the row at
                the status's left edge — there is no avatar column to pull back
                over. */}
            <Actions
              host={host}
              currentActor={currentActor ?? undefined}
              currentTime={currentTime}
              status={status}
              showActions
              fullBleed={false}
              reactionState={reactionState}
              // Same authoring gate the status detail page applies: a signed-in
              // owner edits their own post from its own page rather than having
              // to find it in a feed. Quote comes from the same composer.
              editable={isOwner}
              extraMenuItems={gearMenuItems}
              onReply={() => setActiveSection('comments')}
              onEdit={
                currentActor
                  ? (target) => composer.openEdit(target, status.id)
                  : undefined
              }
              onQuote={
                currentActor
                  ? (target) => composer.openQuote(target, status.id)
                  : undefined
              }
              onShowAttachment={onShowAttachment}
            />
          </div>
        )}

        {/* The shared inline composer, inside the card and beneath the post it
            targets — the same component and the same hook `Posts` and
            `StatusBox` drive, so an edit from here behaves exactly as it does
            in the timeline. It closes itself after a successful write (see
            `InlineStatusComposer`), so the callbacks here only re-fetch. The
            `key` remounts it when the mode changes, rather than carrying a
            quote's draft into an edit. */}
        {composer.active?.anchorId === status.id && currentActor ? (
          <div className="px-4 pb-4">
            <InlineStatusComposer
              key={`${composer.active.mode}-${composer.active.anchorId}`}
              host={host}
              profile={currentActor}
              mode={composer.active.mode}
              status={composer.active.status}
              isMediaUploadEnabled={isMediaUploadEnabled}
              onCancel={composer.close}
              onCreated={() => router.refresh()}
              onUpdated={() => router.refresh()}
            />
          </div>
        ) : null}
      </div>

      {/* Section sub-navigation */}
      <SectionNavSelect
        label="Activity sections"
        tabs={tabs}
        active={activeSection}
        onChange={setActiveSection}
      />

      {/* This page replaces `Post` for a completed fitness activity, so the
          retry `Post` offers for a missing route map has to exist here too —
          otherwise the owner who opens the activity to ask where their map went
          is the one person who cannot act on it.
          Read from `status.fitness` (the status's primary file), NOT the
          file the switcher has selected: the retry endpoint only acts on the
          primary, so a button driven by a non-primary file's reason would 422
          on every click. Same `completed` gate `Post` applies. */}
      {status.fitness?.mapFailure &&
      status.fitness?.processingStatus === 'completed' &&
      isOwner ? (
        <RetryFitnessButton
          statusId={status.id}
          variant={`map-${status.fitness.mapFailure}`}
        />
      ) : null}

      {/* When the route-data load fails and there is no map panel to host the
          banner, surface the error here so the failure is never invisible. */}
      {routeDataError && !shouldRenderMapPanel ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {routeDataError}
        </div>
      ) : null}

      <div
        className="min-w-0"
        role="region"
        aria-label={
          tabs.find((tab) => tab.id === activeSection)?.label ?? 'Activity'
        }
      >
        {activeSection === 'overview' && (
          <div className="space-y-4">
            {shouldRenderMapPanel && (
              <ActivityMapPanel
                mapAttachment={mapAttachment}
                routeSamples={routeSamples}
                routeSegments={routeSegments}
                highlightedElapsedSeconds={highlightedElapsedSeconds}
                mapProvider={mapProvider}
                routeDataError={routeDataError}
                isRouteDataLoading={isRouteDataLoading}
                onOpenMap={() => {
                  if (mapAttachmentIndex >= 0) {
                    onShowAttachment(status.attachments, mapAttachmentIndex)
                  }
                }}
              />
            )}

            {secondaryStats.length > 0 && (
              // Same strip, same rule as the header's — the two measure
              // themselves separately (this one is not inside the card's `p-5`,
              // so it is 42px wider) and can legitimately disagree by one step
              // in a narrow band of window widths. That is the rule working on
              // real available width, which is the whole point of it.
              <FitnessStatGrid>
                {secondaryStats.map((stat) => (
                  <StatTile
                    key={stat.label}
                    icon={stat.icon}
                    label={stat.label}
                    value={stat.value}
                    sub={stat.sub}
                  />
                ))}
              </FitnessStatGrid>
            )}

            {activitySeries.elevation.length > 0 && (
              <Card>
                <SectionTitle
                  icon={Mountain}
                  right={
                    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {/* The scrubbed instant REPLACES the gain rather than
                          prefixing it, the same way the Analysis card swaps its
                          hover hint for "Selected time". Prefixing made this
                          slot grow past the heading row's width at the 320px
                          reflow target, and `formatFitnessDuration` widens from
                          M:SS to H:MM:SS at exactly 3600s — so dragging across
                          the one-hour mark wrapped the row to two lines and
                          pushed the chart 8px down under the user's own finger,
                          then snapped back when they lifted it. The gain is the
                          resting state and returns the moment the scrub ends. */}
                      {highlightedElapsedLabel ??
                        `${Math.max(0, Math.round(elevationGainMeters))} m gain`}
                    </span>
                  }
                >
                  Elevation
                </SectionTitle>
                <ElevationProfileChart
                  values={activitySeries.elevation}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                />
              </Card>
            )}
          </div>
        )}

        {activeSection === 'analysis' && (
          <div className="space-y-4">
            {/* Keep the heading outline contiguous (h1 -> h2 -> h3); the
                section is already visually identified by the sub-nav. */}
            <h2 className="sr-only">Analysis</h2>
            {shouldRenderMapPanel && (
              <ActivityMapPanel
                mapAttachment={mapAttachment}
                routeSamples={routeSamples}
                routeSegments={routeSegments}
                highlightedElapsedSeconds={highlightedElapsedSeconds}
                mapProvider={mapProvider}
                routeDataError={routeDataError}
                isRouteDataLoading={isRouteDataLoading}
                onOpenMap={() => {
                  if (mapAttachmentIndex >= 0) {
                    onShowAttachment(status.attachments, mapAttachmentIndex)
                  }
                }}
              />
            )}

            <FitnessAnalysisCharts
              activitySeries={activitySeries}
              durationSeconds={durationSeconds}
              highlightedElapsedSeconds={highlightedElapsedSeconds}
              onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
              graphDisplayMode={graphDisplayMode}
              onGraphDisplayModeChange={setGraphDisplayMode}
              selectedGraphKeys={selectedGraphKeys}
              onToggleGraphKey={toggleGraphKey}
              isRouteDataLoading={isRouteDataLoading}
              routeDataError={routeDataError}
            />
          </div>
        )}

        {activeSection === 'heart-rate-zones' && (
          <Card>
            <SectionTitle
              icon={HeartPulse}
              right={
                heartRateStats ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    avg {heartRateStats.avg} · max {heartRateStats.max} bpm
                  </span>
                ) : null
              }
            >
              Heart rate zones
            </SectionTitle>
            <HeartRateZonesPanel zones={heartRateZones} />
          </Card>
        )}

        {activeSection === '25w-distribution' && (
          <Card>
            <SectionTitle
              icon={BarChart3}
              right={
                avgPower !== null && maxPower !== null ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    avg {avgPower} · max {maxPower} W
                  </span>
                ) : null
              }
            >
              Power distribution
            </SectionTitle>
            <div className="grid grid-cols-[auto_1fr] items-stretch gap-4">
              <div
                className={cn(
                  'flex flex-col justify-between py-1 text-[11px] tabular-nums text-muted-foreground',
                  GRAPH_HEIGHT_CLASSNAME
                )}
              >
                {histogramLayout.yAxisTicks
                  .slice()
                  .reverse()
                  .map((tick, i) => (
                    <span key={`y-tick-${i}`} className="pr-2 text-right">
                      {tick.label}
                    </span>
                  ))}
              </div>
              <div className="relative min-w-0 pt-1">
                <svg
                  viewBox={`0 0 760 ${histogramLayout.histogramViewHeight}`}
                  preserveAspectRatio="none"
                  className={cn('w-full', GRAPH_HEIGHT_CLASSNAME)}
                >
                  {/* Grid lines */}
                  {histogramLayout.yAxisTicks.map((tick, i) => (
                    <line
                      key={`grid-${i}`}
                      x1="0"
                      y1={tick.y}
                      x2="760"
                      y2={tick.y}
                      className="stroke-muted stroke-[1]"
                    />
                  ))}

                  {/* Bars */}
                  {histogramMinutes.map((value, index) => {
                    const x =
                      index *
                      (histogramLayout.barWidth + histogramLayout.barGap)
                    const barHeight =
                      (value / histogramLayout.maxValue) *
                      histogramLayout.histogramHeight
                    const y = histogramLayout.histogramViewHeight - barHeight
                    const isHovered = hoveredBucketIndex === index

                    return (
                      <rect
                        key={`bar-${index}`}
                        x={x}
                        y={y}
                        width={histogramLayout.barWidth}
                        height={barHeight}
                        fill={getBarColor(index, histogramLayout.barCount)}
                        className={cn(
                          'cursor-crosshair transition-opacity',
                          hoveredBucketIndex !== null && !isHovered
                            ? 'opacity-40'
                            : 'opacity-100'
                        )}
                        onMouseMove={() => setHoveredBucketIndex(index)}
                        onMouseLeave={() => setHoveredBucketIndex(null)}
                      />
                    )
                  })}

                  {/* Hover Tooltip */}
                  {hoveredBucketIndex !== null &&
                    (() => {
                      const value = histogramMinutes[hoveredBucketIndex]
                      const totalMinutes = histogramMinutes.reduce(
                        (a, b) => a + b,
                        0
                      )
                      const percentage =
                        totalMinutes > 0 ? (value / totalMinutes) * 100 : 0
                      const powerRange = `${hoveredBucketIndex * 25}-${
                        (hoveredBucketIndex + 1) * 25
                      }W`

                      // Tooltip positioning
                      const tooltipWidth = 140
                      const tooltipHeight = 60
                      let tooltipX =
                        hoveredBucketIndex *
                          (histogramLayout.barWidth + histogramLayout.barGap) +
                        histogramLayout.barWidth / 2 -
                        tooltipWidth / 2
                      // Keep within bounds
                      tooltipX = Math.max(
                        0,
                        Math.min(760 - tooltipWidth, tooltipX)
                      )
                      const tooltipY = Math.max(
                        0,
                        histogramLayout.histogramViewHeight -
                          (value / histogramLayout.maxValue) *
                            histogramLayout.histogramHeight -
                          tooltipHeight -
                          10
                      )

                      return (
                        <g
                          transform={`translate(${tooltipX}, ${tooltipY})`}
                          className="pointer-events-none"
                        >
                          <rect
                            width={tooltipWidth}
                            height={tooltipHeight}
                            rx="4"
                            className="fill-slate-900/90"
                          />
                          <text
                            x={tooltipWidth / 2}
                            y="20"
                            textAnchor="middle"
                            className="fill-white text-[11px] font-bold"
                          >
                            {powerRange}
                          </text>
                          <text
                            x={tooltipWidth / 2}
                            y="38"
                            textAnchor="middle"
                            className="fill-slate-300 text-[11px]"
                          >
                            {formatDuration(Math.round(value * 60))} (
                            {percentage.toFixed(1)}%)
                          </text>
                        </g>
                      )
                    })()}

                  {/* Weighted Average Line */}
                  <line
                    x1={histogramLayout.weightedAvgX}
                    y1={histogramLayout.histogramTopPadding}
                    x2={histogramLayout.weightedAvgX}
                    y2={histogramLayout.histogramViewHeight}
                    stroke="#a65e92"
                    strokeWidth="1.5"
                    strokeDasharray="4,4"
                  />
                  <text
                    x={Math.min(
                      Math.max(histogramLayout.weightedAvgX, 80),
                      680
                    )}
                    y={histogramLayout.histogramTopPadding - 6}
                    textAnchor="middle"
                    fill="#a65e92"
                    fontSize="12"
                    className="font-medium"
                  >
                    Average Power {histogramLayout.weightedAvgPowerValue} W
                  </text>
                </svg>

                {/* X-Axis labels */}
                <div className="relative mt-2 flex h-6 border-t border-border pt-2 text-[11px] tabular-nums text-muted-foreground">
                  {histogramMinutes.map((_, index) => {
                    // Show label at start of bucket, only every 50W (index % 2 === 0)
                    if (index % 2 !== 0) return null

                    const leftPercent = (index / histogramLayout.barCount) * 100
                    return (
                      <span
                        key={`label-${index}`}
                        className="absolute"
                        style={{ left: `${leftPercent}%` }}
                      >
                        {index * 25} W
                      </span>
                    )
                  })}
                  {/* Final label at the end */}
                  <span className="absolute right-0 text-right">
                    {histogramLayout.barCount * 25} W
                  </span>
                </div>
              </div>
            </div>
          </Card>
        )}

        {activeSection === 'photos' && (
          <Card padded={false} className="p-4">
            <SectionTitle
              icon={ImageIcon}
              right={
                <span className="text-xs text-muted-foreground">
                  {mediaWithoutMap.length}{' '}
                  {mediaWithoutMap.length === 1 ? 'photo' : 'photos'}
                </span>
              }
            >
              Photos
            </SectionTitle>
            <ActivityGallery
              attachments={mediaWithoutMap}
              onOpenAttachment={(index) => {
                const target = status.attachments.findIndex(
                  (attachment) => attachment.id === mediaWithoutMap[index]?.id
                )
                if (target >= 0) {
                  onShowAttachment(status.attachments, target)
                }
              }}
            />
          </Card>
        )}

        {activeSection === 'comments' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Boosts', value: status.totalShares },
                { label: 'Likes', value: status.totalLikes },
                { label: 'Comments', value: replies.length }
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border bg-background p-3.5 text-center shadow-sm"
                >
                  <div className="text-2xl font-semibold tabular-nums">
                    {stat.value}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {currentActor ? (
              <StatusReplyBox
                key={composerKey}
                profile={currentActor}
                replyStatus={status}
                isMediaUploadEnabled={isMediaUploadEnabled}
                onCancel={() => setComposerKey((value) => value + 1)}
                onPostCreated={() => {
                  setComposerKey((value) => value + 1)
                  router.refresh()
                }}
              />
            ) : null}

            {replies.length > 0 ? (
              <div className="divide-y rounded-xl border bg-card">
                {replies.map((reply) => (
                  <article key={reply.id} className="p-4">
                    <Post
                      host={host}
                      currentActor={currentActor ?? undefined}
                      currentTime={currentTime}
                      status={reply}
                      collapsible
                      onShowAttachment={onShowAttachment}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
                No comments yet.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
