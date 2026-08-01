'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'
import {
  Activity,
  BarChart3,
  Calendar,
  ChevronDown,
  Clock,
  ExternalLink,
  Flame,
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
  Unlock
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  FC,
  type MouseEvent,
  ReactNode,
  type TouchEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  type FitnessRouteSample,
  type FitnessRouteSegment,
  type StatusFitnessFileItem,
  getFitnessFilesByStatus,
  getFitnessRouteData
} from '@/lib/client'
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
import { BrandedDeviceLink } from '@/lib/components/posts/BrandedDeviceLink'
import { Actions } from '@/lib/components/posts/actions/actions'
import { ActorAvatar } from '@/lib/components/posts/actor'
import { Media } from '@/lib/components/posts/media'
import { Post } from '@/lib/components/posts/post'
import { ReactionRow } from '@/lib/components/posts/reaction-row'
import { RetryFitnessButton } from '@/lib/components/posts/retry-fitness-button'
import { StatusReplyBox } from '@/lib/components/posts/status-reply-box'
import { useReactionState } from '@/lib/components/posts/useReactionState'
import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  formatFitnessDuration,
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
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

const clampNumber = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

// How densely a chart series is plotted, as samples-per-drawn-point.
//
// The series used to be flattened to a fixed 120 points, which is what made
// every graph on this page read as a smoothed cartoon of the activity beside
// the same ride on Strava: a 1h44 recording arrives as 6,123 one-second
// samples, so each of those 120 bins averaged ~51 seconds — roughly 370 m of a
// 44 km ride — and every short climb, descent and sprint inside a bin was
// averaged flat.
//
// 8 is Strava's own ratio, read off two of its activity Analysis pages rather
// than guessed: it ships the whole stream to the browser and draws exactly one
// point per 8 of them (5,913 samples -> 740 drawn; 5,272 -> 659). A fixed point
// COUNT would not reproduce that — it is a density, so a longer recording gets
// proportionally more points rather than being squeezed into the same budget.
const ANALYSIS_SAMPLES_PER_POINT = 8
// Floors and ceilings on that ratio. The floor keeps a short activity at least
// as detailed as it was before this change (a 10-minute 1 Hz recording is 600
// samples, which Strava's ratio alone would draw as 75 points); the ceiling
// bounds the path strings — memoized, so a hover never rebuilds them — for a
// recording long enough that the ratio would otherwise run away.
const ANALYSIS_SERIES_MIN_POINTS = 120
const ANALYSIS_SERIES_MAX_POINTS = 1_200

const downsampleSeries = (series: number[], targetCount: number) => {
  if (series.length <= targetCount) return series
  const ratio = series.length / targetCount
  const result: number[] = []
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.floor((i + 1) * ratio)
    const chunk = series.slice(start, end)
    const sum = chunk.reduce((a, b) => a + b, 0)
    result.push(sum / chunk.length)
  }
  return result
}

// Reduce one raw series to the point count Strava would draw it at. An empty
// series stays empty — a chart with no data is not rendered at all.
const plotAtStravaDensity = (series: number[]) => {
  if (series.length === 0) return []
  return downsampleSeries(
    series,
    clampNumber(
      Math.round(series.length / ANALYSIS_SAMPLES_PER_POINT),
      ANALYSIS_SERIES_MIN_POINTS,
      ANALYSIS_SERIES_MAX_POINTS
    )
  )
}

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

type AnalysisGraphKey = 'elevation' | 'speed' | 'power' | 'heart-rate'
// How the selected graphs are drawn: `separate` stacks each into its own row of
// one bordered panel (the original behaviour); `combined` overlays them all in a
// single chart, each series scaled to its own range.
type GraphDisplayMode = 'separate' | 'combined'

const GRAPH_DISPLAY_MODES: Array<{ id: GraphDisplayMode; label: string }> = [
  { id: 'separate', label: 'Separate' },
  { id: 'combined', label: 'Combined' }
]

interface SectionTab {
  id: SectionKey
  label: string
  icon: LucideIcon
}

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

// One toggle per series (no "all" pseudo-option): the graphs to show are picked
// as a multi-select, so "show everything" is simply every chip on — which is the
// default — rather than a distinct mode.
const ANALYSIS_GRAPH_OPTIONS: Array<{
  id: AnalysisGraphKey
  label: string
}> = [
  { id: 'elevation', label: 'Elevation' },
  { id: 'speed', label: 'Speed' },
  { id: 'power', label: 'Power' },
  { id: 'heart-rate', label: 'Heart rate' }
]

// One colour per series, used for the line, the hover crosshair and the hover
// dot alike — so a stacked graph is identifiable by its own colour rather than
// every crosshair sharing the speed chart's blue. `chipBorder` tints a selected
// picker chip and the combined-chart legend with that same series colour.
const ANALYSIS_GRAPH_STYLES: Record<
  AnalysisGraphKey,
  { stroke: string; dot: string; chipBorder: string }
> = {
  elevation: {
    stroke: 'stroke-slate-400',
    dot: 'bg-slate-400',
    chipBorder: 'border-slate-400'
  },
  speed: {
    stroke: 'stroke-sky-500',
    dot: 'bg-sky-500',
    chipBorder: 'border-sky-500'
  },
  power: {
    stroke: 'stroke-violet-500',
    dot: 'bg-violet-500',
    chipBorder: 'border-violet-500'
  },
  'heart-rate': {
    stroke: 'stroke-rose-500',
    dot: 'bg-rose-500',
    chipBorder: 'border-rose-500'
  }
}

// `toFixed` keeps the sign of a value that rounds to zero, so an elevation bin
// straddling sea level reads "-0 m". Round first, then add zero — `-0 + 0` is
// `+0` — so a chart can only ever show a plain "0". EVERY number a chart prints
// goes through this, not just the hover readout: the scale labels are derived
// from the same downsampled bins, so fixing one and not the others left a chart
// reading "Scale -0 m - 55 m" beside a readout saying "0 m".
const formatChartValue = (value: number, fractionDigits: number) =>
  (Number(value.toFixed(fractionDigits)) + 0).toFixed(fractionDigits)

const VISIBILITY_META: Record<
  MastodonVisibility,
  { label: string; icon: LucideIcon }
> = {
  public: { label: 'Public', icon: Globe },
  unlisted: { label: 'Unlisted', icon: Unlock },
  private: { label: 'Followers only', icon: Lock },
  direct: { label: 'Direct', icon: Mail }
}

interface HeartRateZoneDefinition {
  name: string
  label: string
  lo: number
  hi: number | null
  color: string
}

// Fixed heart-rate zone boundaries (bpm), mirroring the design system's
// five-zone model. Real activity files carry a heart-rate sample series but no
// personalised zones, so we bucket the samples against these shared cut-offs.
const HEART_RATE_ZONES: HeartRateZoneDefinition[] = [
  { name: 'Z1', label: 'Recovery', lo: 0, hi: 122, color: 'hsl(205 45% 62%)' },
  {
    name: 'Z2',
    label: 'Endurance',
    lo: 122,
    hi: 142,
    color: 'hsl(142 60% 45%)'
  },
  { name: 'Z3', label: 'Tempo', lo: 142, hi: 158, color: 'hsl(45 92% 50%)' },
  {
    name: 'Z4',
    label: 'Threshold',
    lo: 158,
    hi: 172,
    color: 'hsl(24 95% 50%)'
  },
  { name: 'Z5', label: 'Anaerobic', lo: 172, hi: null, color: 'hsl(2 78% 55%)' }
]

interface HeartRateZone extends HeartRateZoneDefinition {
  seconds: number
  // Rounded percentage for display; rawPct (unrounded) drives bar widths so
  // the stacked segments don't under/overflow from rounding.
  pct: number
  rawPct: number
}

const computeHeartRateZones = (
  series: number[],
  durationSeconds: number
): HeartRateZone[] => {
  const counts = HEART_RATE_ZONES.map(() => 0)
  for (const bpm of series) {
    // Heart-rate monitors report 0 (or negative) bpm during sensor dropouts;
    // skip those so they don't inflate the Z1 (Recovery) bucket.
    if (bpm <= 0) continue
    const index = HEART_RATE_ZONES.findIndex(
      (zone) => bpm >= zone.lo && (zone.hi === null || bpm < zone.hi)
    )
    if (index >= 0) counts[index] += 1
  }
  const totalSamples = counts.reduce((sum, value) => sum + value, 0)
  return HEART_RATE_ZONES.map((zone, index) => {
    const fraction = totalSamples > 0 ? counts[index] / totalSamples : 0
    return {
      ...zone,
      pct: Math.round(fraction * 100),
      rawPct: fraction * 100,
      seconds: Math.round(fraction * durationSeconds)
    }
  })
}

const formatDuration = (durationSeconds?: number) =>
  formatFitnessDuration(durationSeconds, { fallback: '0:00' }) ?? '0:00'

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

  return `${activityType[0].toUpperCase()}${activityType.slice(1)}`
}

const GRAPH_VIEW_HEIGHT = 250
const GRAPH_HEIGHT_CLASSNAME = 'h-[190px] lg:h-[250px]'
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

// The one projection from (sample index, sample value) to plot coordinates.
// `buildChartPath` draws the line with it and the hover crosshair places the
// dot and the readout with it, and those two have to agree to the pixel or the
// dot floats off the line it is supposed to sit on. That used to be two copies
// of the same arithmetic kept in step by hand, which was survivable while both
// lived in the same SVG — the dot is now an HTML element positioned from these
// same numbers as a percentage, so the agreement now spans two rendering
// systems. Change the scale here and everything follows.
const getChartXPosition = (index: number, count: number, width: number) => {
  return (index / Math.max(1, count - 1)) * width
}

const getChartYPosition = (
  value: number,
  height: number,
  minValue: number,
  maxValue: number
) => {
  const range = Math.max(1, maxValue - minValue)
  return height - ((value - minValue) / range) * height
}

const clampLongitude = (value: number) => {
  return clampNumber(value, -180, 180)
}

const clampLatitude = (value: number) => {
  return clampNumber(value, -85, 85)
}

const getSeriesMinMax = (values: number[]) => {
  if (values.length === 0) {
    return { minValue: 0, maxValue: 0 }
  }

  let minValue = values[0]
  let maxValue = values[0]

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < minValue) {
      minValue = values[index]
    } else if (values[index] > maxValue) {
      maxValue = values[index]
    }
  }

  return { minValue, maxValue }
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

const buildChartPath = (
  values: number[],
  width: number,
  height: number,
  minValue?: number,
  maxValue?: number
) => {
  if (values.length === 0) return ''

  const defaultMinMax = getSeriesMinMax(values)
  const min = typeof minValue === 'number' ? minValue : defaultMinMax.minValue
  const max = typeof maxValue === 'number' ? maxValue : defaultMinMax.maxValue

  return values
    .map((value, index) => {
      const x = getChartXPosition(index, values.length, width)
      const y = getChartYPosition(value, height, min, max)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

// Ticks are evenly spaced over the duration, so the sample count has no say in
// them — it used to be the first parameter and was never read, which made the
// labels look series-dependent when they are not.
const buildXAxisLabels = (durationSeconds: number, tickCount = 6) => {
  const labels: string[] = []
  for (let i = 0; i < tickCount; i++) {
    const ratio = i / (tickCount - 1)
    const seconds = Math.round(ratio * durationSeconds)
    labels.push(formatDuration(seconds))
  }
  return labels
}

interface ChartScrubOptions {
  values: number[]
  width: number
  height: number
  minValue: number
  maxValue: number
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}

// Everything a chart needs to follow the pointer: whether it can, where the
// highlighted sample sits in plot coordinates, and the DOM handlers that turn a
// pointer or a finger into an elapsed time.
//
// This lives in one hook because two visually different charts now share the
// behaviour — the Analysis stack's line panels and the Overview's filled
// elevation profile. Keeping the geometry beside the handlers is what stops the
// dot from drifting off the line: both read the same `getChartXPosition` /
// `getChartYPosition` projection the path was drawn with.
const useChartScrub = ({
  values,
  width,
  height,
  minValue,
  maxValue,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}: ChartScrubOptions) => {
  const canScrub =
    typeof onHighlightElapsedSeconds === 'function' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0 &&
    values.length > 0

  // One nullable object rather than three parallel nullable fields plus an
  // `isHighlighted` boolean: a boolean beside them narrows nothing, so every
  // consumer had to re-assert that x, y and value were numbers before it could
  // pass them anywhere typed.
  const highlightedIndex =
    canScrub && typeof highlightedElapsedSeconds === 'number'
      ? clampNumber(
          Math.round(
            (highlightedElapsedSeconds / durationSeconds) * (values.length - 1)
          ),
          0,
          values.length - 1
        )
      : null
  const highlight =
    highlightedIndex === null
      ? null
      : {
          value: values[highlightedIndex],
          x: getChartXPosition(highlightedIndex, values.length, width),
          y: getChartYPosition(
            values[highlightedIndex],
            height,
            minValue,
            maxValue
          )
        }

  // One scrub for pointer and touch alike: both report a viewport x, and the
  // instant it lands on is the same either way.
  const scrubToClientX = (clientX: number | undefined, plot: SVGSVGElement) => {
    if (!canScrub || !onHighlightElapsedSeconds) return
    if (typeof clientX !== 'number') return
    const bounds = plot.getBoundingClientRect()
    const ratio = clampNumber(
      (clientX - bounds.left) / Math.max(bounds.width, 1),
      0,
      1
    )
    onHighlightElapsedSeconds(ratio * durationSeconds)
  }

  const clearScrub = () => {
    if (!canScrub || !onHighlightElapsedSeconds) return
    onHighlightElapsedSeconds(null)
  }

  const plotHandlers = {
    onMouseMove: (event: MouseEvent<SVGSVGElement>) => {
      scrubToClientX(event.clientX, event.currentTarget)
    },
    onMouseLeave: clearScrub,
    onTouchStart: (event: TouchEvent<SVGSVGElement>) => {
      scrubToClientX(event.touches[0]?.clientX, event.currentTarget)
    },
    onTouchMove: (event: TouchEvent<SVGSVGElement>) => {
      scrubToClientX(event.touches[0]?.clientX, event.currentTarget)
    },
    onTouchEnd: (event: TouchEvent<SVGSVGElement>) => {
      // A tap is followed by compatibility `mousemove`/`mousedown`/…
      // at the same point, and that `mousemove` would re-enter the scrub
      // the moment this clears it — leaving the readout stuck on, because
      // no `mouseleave` follows a touch. Preventing the default suppresses
      // that whole compat sequence; the chart has no click behaviour to
      // lose, and a drag never gets here stuck anyway because movement
      // past the tap slop suppresses the compat events on its own.
      // Guarded on `cancelable`: once a scroll is underway Chrome keeps
      // dispatching `touchend` with `cancelable: false` rather than
      // switching to `touchcancel`, and calling this on one of those is a
      // no-op that logs a warning on every vertical swipe that started on
      // a chart — which is most of them, under four stacked full-width
      // charts.
      if (event.cancelable) event.preventDefault()
      clearScrub()
    },
    onTouchCancel: clearScrub
  }

  // A vertical swipe still scrolls the page and a pinch still zooms; only the
  // horizontal drag is claimed, for scrubbing. Both of the other two have to be
  // named explicitly — `touch-pan-y` on its own compiles to exactly
  // `touch-action: pan-y`, which drops pinch-zoom, and blocking magnification
  // over a stack of charts takes it away in the one place a low-vision reader
  // most wants it.
  const plotClassName = canScrub
    ? 'cursor-crosshair touch-pan-y touch-pinch-zoom'
    : undefined

  return {
    canScrub,
    highlight,
    plotClassName,
    plotHandlers
  }
}

// The dot pinned to the highlighted sample plus the value chip beside it,
// shared by every scrubbable chart so the two never drift apart.
const ChartHoverMarker: FC<{
  x: number
  y: number
  width: number
  height: number
  value: number
  unit: string
  fractionDigits: number
  dotClassName?: string
}> = ({ x, y, width, height, value, unit, fractionDigits, dotClassName }) => {
  // The readout sits beside the dot and flips to its left near the right edge.
  // The threshold is a fraction of the viewBox while the chip is a fixed pixel
  // width, so the two only agree above some container width, and the binding
  // case is the narrowest host at the 320px reflow target.
  //
  // Derived for the Analysis stack, where the plot is 220px and the chip is
  // ~77px for the widest value those series realistically produce
  // ("13.5 km/h"), against a budget of that 220px plus the panel's own 16px
  // right padding: the design kit's 0.72 lands 12px past what will be shown,
  // anything at or below 0.66 fits, and 0.62 keeps a margin for a longer value
  // or a wider font — at the cost of flipping sooner than the kit does in a
  // desktop column, where there is still room to the right.
  //
  // Re-checked for the Overview elevation card, which is the other host and a
  // tighter one: a `Card` has no `overflow-hidden` to clip a chip that escapes,
  // and its plot is 212px rather than 220px. It is still safe, because its chip
  // is also smaller ("1234 m" is ~67px against that 77px), so the right edge
  // lands at 0.62 x 212 + 12 + 67 = 210px — inside the 212px plot, before
  // touching the card's 20px padding. Re-derive BOTH if this moves.
  const shouldFlipReadout = x / width > 0.62

  return (
    <>
      {/* The dot is HTML, not an SVG `circle`: `preserveAspectRatio="none"`
          scales x and y independently, so a circle renders as an ellipse that
          is half again as wide as it is tall in a desktop column and nearly
          twice as tall as wide on a phone. Positioned by the same percentage
          mapping as the readout — exact under that same `none`. */}
      <span
        aria-hidden="true"
        data-testid="chart-hover-dot"
        className={cn(
          'pointer-events-none absolute z-10 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
          dotClassName ?? 'bg-sky-500'
        )}
        style={{
          left: `${(x / width) * 100}%`,
          top: `${(y / height) * 100}%`
        }}
      />
      {/* Value readout pinned to the hover dot. Percentage positioning works
          because `preserveAspectRatio="none"` maps the viewBox linearly onto
          the rendered box; the vertical clamp keeps it inside the plot when
          the sample sits against the top or bottom of the scale.
          `aria-hidden` because it is the running commentary on a pointer
          gesture, which a screen reader would otherwise meet as a bare figure
          with no context, attached to a control it cannot drive. Note the
          Analysis panel also prints the same range in its "Scale …" header
          while the elevation card does not, so on that card the scrubbed
          value is genuinely pointer-only — the same gap the charts already
          have for a keyboard user, and a follow-up rather than something this
          chip should paper over with a live region.
          Keeping it inside the panel is the flip threshold's job, not a
          `max-width`'s — the chip is clipped by where it is positioned, and
          a cap wide enough to never truncate the text is also too wide to
          ever bind. */}
      <div
        aria-hidden="true"
        data-testid="chart-hover-value"
        className="pointer-events-none absolute z-20 flex items-baseline gap-1 rounded-md border bg-background px-2 py-1 shadow-sm"
        style={{
          left: `${(x / width) * 100}%`,
          top: `${clampNumber((y / height) * 100, 8, 92)}%`,
          transform: shouldFlipReadout
            ? 'translate(calc(-100% - 12px), -50%)'
            : 'translate(12px, -50%)'
        }}
      >
        <span className="text-sm font-semibold leading-none tabular-nums text-foreground">
          {formatChartValue(value, fractionDigits)}
        </span>
        <span className="text-[10px] leading-none text-muted-foreground">
          {unit}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 size-2 bg-background',
            shouldFlipReadout
              ? '-right-[4.5px] border-r border-t'
              : '-left-[4.5px] border-b border-l'
          )}
          style={{ transform: 'translateY(-50%) rotate(45deg)' }}
        />
      </div>
    </>
  )
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

// State-driven section dropdown that mirrors the shared `SectionNavDropdown`
// (the design-system sub-nav used by settings/fitness/admin). That component is
// URL/link-based; the activity detail switches sections in local state, so this
// renders the same outline trigger + menu but drives `onChange` instead.
const SectionNav: FC<{
  tabs: SectionTab[]
  active: SectionKey
  onChange: (id: SectionKey) => void
}> = ({ tabs, active, onChange }) => {
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0]
  const ActiveIcon = activeTab.icon

  return (
    <nav aria-label="Activity sections" className="w-full sm:max-w-[260px]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Chrome kept in step with SectionNavDropdown: h-10/rounded-lg
              trigger, muted chevron, rounded-xl/shadow-lg menu, roomy
              font-medium rows. */}
          <Button
            variant="outline"
            className="h-10 w-full justify-between rounded-lg"
          >
            <span className="flex items-center gap-2">
              <ActiveIcon className="size-4 text-primary" />
              {activeTab.label}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        {/* Tailwind v4 parenthesis syntax — the v3 `w-[--radix-…]` form emits
            `width: --radix-…` instead of `width: var(--radix-…)`, which the
            browser drops, leaving the menu narrower than its trigger. */}
        <DropdownMenuContent
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width) rounded-xl shadow-lg"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = tab.id === activeTab.id
            return (
              <DropdownMenuItem
                key={tab.id}
                onSelect={() => onChange(tab.id)}
                // State-driven menu (no navigation), so use the boolean form
                // rather than aria-current="page".
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 font-medium',
                  isActive && [
                    'bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary',
                    // Keeps focus visible on the current row, which otherwise
                    // looks identical focused and at rest. See the same ring in
                    // SectionNavDropdown.
                    'focus:ring-2 focus:ring-primary/50'
                  ]
                )}
              >
                <Icon
                  className={cn(
                    'size-4',
                    isActive ? 'text-primary' : 'text-popover-foreground'
                  )}
                />
                {tab.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

// The Overview's filled elevation profile. Visually it is its own thing — the
// orange area fill under a heavier line, sized for a summary card — but it
// scrubs exactly like the Analysis stack does, off the same `useChartScrub`
// hook and the same shared marker, so dragging it reports the elevation under
// the pointer and moves the highlight on the map above it.
const ElevationProfileChart: FC<{
  values: number[]
  height?: number
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}> = ({
  values,
  height = 130,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}) => {
  const width = 800
  const { minValue, maxValue } = useMemo(
    () => getSeriesMinMax(values),
    [values]
  )
  // Memoized because the series is now plotted at Strava's density: rebuilding
  // a path string of up to 1,200 points on every pointer move would be the one
  // expensive thing a scrub does.
  const line = useMemo(
    () => buildChartPath(values, width, height, minValue, maxValue),
    [values, height, minValue, maxValue]
  )
  const area = useMemo(
    () => `${line} L ${width.toFixed(2)} ${height} L 0 ${height} Z`,
    [line, height]
  )
  // Four ticks, not the helper's default six. This card is narrower than the
  // Analysis panel (a `p-5` Card inside the same column, so 212px of content at
  // the 320px reflow target against that panel's 220px), `justify-between`
  // gives a label row no way to wrap, and a Card has no `overflow-hidden` to
  // clip a row that outgrows it the way that panel does — so an over-wide row
  // here runs its labels together into one unbroken string of digits and then
  // crosses the card's own border.
  //
  // Worked at 11px tabular-nums, where "0:00" is ~24px and one "H:MM:SS" label
  // ~42px (a five-hour ride, the point at which every tick but the first has
  // taken the wider form): six labels need 24 + 5x42 = 234px against 212px,
  // while four need 24 + 3x42 = 150px and keep ~20px between each. Going longer
  // adds little: `formatFitnessDuration` does not zero-pad the hour, so a
  // ten-hour ride widens only the labels that reach two digits (~49px) — 241px
  // at six ticks, a still-comfortable 157px at four. Pinned by a test, since
  // the failure is silent — nothing errors, the labels just merge.
  const xLabels = useMemo(
    () => (durationSeconds ? buildXAxisLabels(durationSeconds, 4) : null),
    [durationSeconds]
  )
  const scrub = useChartScrub({
    values,
    width,
    height,
    minValue,
    maxValue,
    durationSeconds,
    highlightedElapsedSeconds,
    onHighlightElapsedSeconds
  })

  return (
    <div data-testid="overview-elevation-profile">
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={cn('block h-full w-full', scrub.plotClassName)}
          {...scrub.plotHandlers}
        >
          <defs>
            <linearGradient
              id="fitness-elevation-gradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0" stopColor="hsl(24 95% 46%)" stopOpacity="0.28" />
              <stop offset="1" stopColor="hsl(24 95% 46%)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line
            x1={0}
            y1={height / 2}
            x2={width}
            y2={height / 2}
            className="stroke-border"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <path d={area} fill="url(#fitness-elevation-gradient)" />
          <path
            d={line}
            fill="none"
            className="stroke-primary"
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {scrub.highlight ? (
            <line
              x1={scrub.highlight.x}
              y1={0}
              x2={scrub.highlight.x}
              y2={height}
              vectorEffect="non-scaling-stroke"
              className="stroke-primary stroke-[1.5] opacity-60"
            />
          ) : null}
        </svg>
        {scrub.highlight ? (
          <ChartHoverMarker
            x={scrub.highlight.x}
            y={scrub.highlight.y}
            width={width}
            height={height}
            value={scrub.highlight.value}
            unit="m"
            fractionDigits={0}
            dotClassName="bg-primary"
          />
        ) : null}
      </div>
      {xLabels && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          {xLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const HeartRateZonesPanel: FC<{ zones: HeartRateZone[] }> = ({ zones }) => {
  const formatZoneRange = (zone: HeartRateZone) => {
    if (zone.lo === 0 && zone.hi !== null) return `< ${zone.hi} bpm`
    if (zone.hi === null) return `${zone.lo}+ bpm`
    return `${zone.lo}–${zone.hi} bpm`
  }

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {zones.map((zone) => (
          // rawPct (unrounded sample share) keeps the stacked segments from
          // under/overflowing; pct is only for the displayed label.
          <div
            key={zone.name}
            title={`${zone.name} ${zone.pct}%`}
            style={{
              width: `${zone.rawPct}%`,
              background: zone.color
            }}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2.5">
        {zones.map((zone) => (
          <div key={zone.name} className="flex items-center gap-3">
            <span
              className="inline-block size-3 shrink-0 rounded-[3px]"
              style={{ background: zone.color }}
              aria-hidden="true"
            />
            <span className="w-7 shrink-0 text-sm font-semibold tabular-nums">
              {zone.name}
            </span>
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              {zone.label}
            </span>
            <span className="hidden w-24 shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
              {formatZoneRange(zone)}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${zone.rawPct}%`, background: zone.color }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
              {formatDuration(zone.seconds)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ChartPanel: FC<{
  title: string
  unit: string
  strokeClassName?: string
  dotClassName?: string
  values: number[]
  minLabel?: string
  maxLabel?: string
  /**
   * Decimals the hover readout uses, kept the same as the scale labels' own
   * precision so the value doesn't switch width between integer and fractional
   * samples as the pointer moves.
   */
  fractionDigits?: number
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}> = ({
  title,
  unit,
  values,
  strokeClassName,
  dotClassName,
  minLabel,
  maxLabel,
  fractionDigits = 0,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}) => {
  const width = 760
  const height = GRAPH_VIEW_HEIGHT
  const { minValue, maxValue } = useMemo(
    () => getSeriesMinMax(values),
    [values]
  )
  const path = useMemo(
    () => buildChartPath(values, width, height, minValue, maxValue),
    [maxValue, minValue, values]
  )
  const minScale = minLabel ? `${minLabel} ${unit}` : `-- ${unit}`
  const maxScale = maxLabel ? `${maxLabel} ${unit}` : `-- ${unit}`
  const xLabels = useMemo(
    () => (durationSeconds ? buildXAxisLabels(durationSeconds) : null),
    [durationSeconds]
  )
  const scrub = useChartScrub({
    values,
    width,
    height,
    minValue,
    maxValue,
    durationSeconds,
    highlightedElapsedSeconds,
    onHighlightElapsedSeconds
  })

  // No border or rounding of its own: every chart is a row of the one bordered
  // panel the Analysis section stacks them into, so a border here would draw a
  // second box inside it.
  return (
    <div className="bg-background p-4">
      <div className="mb-2 flex items-end justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs tabular-nums text-muted-foreground">
          Scale {minScale} - {maxScale}
        </p>
      </div>
      {/* The scale labels overlay the plot's top-left and bottom-left corners
          rather than taking a gutter column, so every stacked chart's plot
          starts and ends at the same x and the rows read as one table. They are
          inside the plot box only — the x-axis labels below sit outside it, so
          the minimum label cannot land on top of the first tick. */}
      <div className={cn('relative', GRAPH_HEIGHT_CLASSNAME)}>
        {/* Each label carries its own backdrop: in the gutter column these
            replaced there was nothing to collide with, but on the plot a series
            that starts at its minimum — speed, power and heart rate nearly
            always do — puts the first path point at exactly `y = height`, i.e.
            straight through the bottom-left label. Above the hover dot
            (`z-10`), which sits at the plot's left edge at the very first
            sample; still below the readout, which is the thing being read. */}
        <span className="pointer-events-none absolute left-0 top-0 z-20 rounded bg-background/95 px-1 text-[11px] tabular-nums text-muted-foreground">
          {maxScale}
        </span>
        <span className="pointer-events-none absolute bottom-0 left-0 z-20 rounded bg-background/95 px-1 text-[11px] tabular-nums text-muted-foreground">
          {minScale}
        </span>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={cn('block h-full w-full', scrub.plotClassName)}
          {...scrub.plotHandlers}
        >
          <path
            d={path}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className={cn('stroke-[2]', strokeClassName ?? 'stroke-sky-500')}
          />
          {scrub.highlight ? (
            <line
              x1={scrub.highlight.x}
              y1={0}
              x2={scrub.highlight.x}
              y2={height}
              vectorEffect="non-scaling-stroke"
              className={cn(
                'stroke-[1.5] opacity-60',
                strokeClassName ?? 'stroke-sky-500'
              )}
            />
          ) : null}
        </svg>
        {scrub.highlight ? (
          <ChartHoverMarker
            x={scrub.highlight.x}
            y={scrub.highlight.y}
            width={width}
            height={height}
            value={scrub.highlight.value}
            unit={unit}
            fractionDigits={fractionDigits}
            dotClassName={dotClassName}
          />
        ) : null}
      </div>
      {xLabels && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          {xLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

interface CombinedChartSeries {
  key: AnalysisGraphKey
  label: string
  unit: string
  values: number[]
  fractionDigits: number
}

// One chart that overlays several series, each scaled to its OWN range so a
// 0–55 m elevation trace and a 90–190 bpm heart-rate trace can share one plot
// without either flattening the other. It scrubs like the stacked `ChartPanel`
// — the same pointer→elapsed handlers move the map highlight above it — but
// draws one coloured line per series under a shared crosshair, and a single
// readout lists every series' value at the hovered instant.
const CombinedChartPanel: FC<{
  series: CombinedChartSeries[]
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}> = ({
  series,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}) => {
  const width = 760
  const height = GRAPH_VIEW_HEIGHT

  // Each series carries its own min/max and its own path, so a shallow trace is
  // not squashed by a taller one sharing the plot. Memoized because the paths
  // run to Strava's density (up to 1,200 points each) and must not rebuild on a
  // pointer move.
  const plotted = useMemo(
    () =>
      series.map((entry) => {
        const { minValue, maxValue } = getSeriesMinMax(entry.values)
        return {
          ...entry,
          minValue,
          maxValue,
          path: buildChartPath(entry.values, width, height, minValue, maxValue)
        }
      }),
    [series]
  )

  // The scrub only turns a pointer x into an elapsed time, so drive it off the
  // longest series — a short or late-starting one would otherwise be the first
  // to run out of samples. Its own single-series `highlight` is ignored; the
  // per-series dots below are placed from each series' own projection instead.
  const scrubDriver = plotted.reduce<(typeof plotted)[number] | null>(
    (longest, entry) =>
      longest && longest.values.length >= entry.values.length ? longest : entry,
    null
  )
  const scrub = useChartScrub({
    values: scrubDriver?.values ?? [],
    width,
    height,
    minValue: scrubDriver?.minValue ?? 0,
    maxValue: scrubDriver?.maxValue ?? 0,
    durationSeconds,
    highlightedElapsedSeconds,
    onHighlightElapsedSeconds
  })

  const ratio =
    scrub.canScrub &&
    typeof highlightedElapsedSeconds === 'number' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0
      ? clampNumber(highlightedElapsedSeconds / durationSeconds, 0, 1)
      : null
  // The crosshair marks the shared time; each dot sits on its own line, at that
  // series' own sample for the instant.
  const crosshairX = ratio === null ? null : ratio * width
  const highlights =
    ratio === null
      ? []
      : plotted
          .map((entry) => {
            if (entry.values.length === 0) return null
            const index = clampNumber(
              Math.round(ratio * (entry.values.length - 1)),
              0,
              entry.values.length - 1
            )
            return {
              key: entry.key,
              unit: entry.unit,
              fractionDigits: entry.fractionDigits,
              value: entry.values[index],
              x: getChartXPosition(index, entry.values.length, width),
              y: getChartYPosition(
                entry.values[index],
                height,
                entry.minValue,
                entry.maxValue
              )
            }
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  const xLabels = useMemo(
    () => (durationSeconds ? buildXAxisLabels(durationSeconds) : null),
    [durationSeconds]
  )

  // Flip the readout to the left of the crosshair near the right edge, on the
  // same fraction the single-series `ChartHoverMarker` uses so both charts agree.
  const shouldFlipReadout = crosshairX !== null && crosshairX / width > 0.62

  return (
    <div className="bg-background p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Combined</h3>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {series.map((entry) => (
            <span
              key={entry.key}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  ANALYSIS_GRAPH_STYLES[entry.key].dot
                )}
              />
              {entry.label}
            </span>
          ))}
        </div>
      </div>
      <div className={cn('relative', GRAPH_HEIGHT_CLASSNAME)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={cn('block h-full w-full', scrub.plotClassName)}
          {...scrub.plotHandlers}
        >
          {plotted.map((entry) => (
            <path
              key={entry.key}
              d={entry.path}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className={cn(
                'stroke-[2]',
                ANALYSIS_GRAPH_STYLES[entry.key].stroke
              )}
            />
          ))}
          {crosshairX !== null ? (
            <line
              x1={crosshairX}
              y1={0}
              x2={crosshairX}
              y2={height}
              vectorEffect="non-scaling-stroke"
              className="stroke-muted-foreground stroke-[1.5] opacity-50"
            />
          ) : null}
        </svg>
        {highlights.map((entry) => (
          <span
            key={entry.key}
            aria-hidden="true"
            data-testid="combined-hover-dot"
            className={cn(
              'pointer-events-none absolute z-10 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
              ANALYSIS_GRAPH_STYLES[entry.key].dot
            )}
            style={{
              left: `${(entry.x / width) * 100}%`,
              top: `${(entry.y / height) * 100}%`
            }}
          />
        ))}
        {/* One readout box for the whole chart rather than a chip per line: three
            overlapping single-value chips would collide. Pinned to the top so it
            never chases a dot across the other series' lines. */}
        {crosshairX !== null && highlights.length > 0 ? (
          <div
            aria-hidden="true"
            data-testid="combined-hover-value"
            className="pointer-events-none absolute top-2 z-20 flex flex-col gap-0.5 rounded-md border bg-background px-2 py-1 shadow-sm"
            style={{
              left: `${(crosshairX / width) * 100}%`,
              transform: shouldFlipReadout
                ? 'translateX(calc(-100% - 12px))'
                : 'translateX(12px)'
            }}
          >
            {highlights.map((entry) => (
              <div key={entry.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    ANALYSIS_GRAPH_STYLES[entry.key].dot
                  )}
                />
                <span className="text-xs font-semibold leading-none tabular-nums text-foreground">
                  {formatChartValue(entry.value, entry.fractionDigits)}
                </span>
                <span className="text-[10px] leading-none text-muted-foreground">
                  {entry.unit}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {xLabels && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          {xLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Each graph is scaled to its own range.
      </p>
    </div>
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
  // This page lays out its own card, so it holds the reaction rollups the way
  // `Post` does — the chip row in the card body and the picker trigger in the
  // shared `Actions` row below both read this one state.
  const reactionState = useReactionState({
    currentActor: currentActor ?? undefined,
    status
  })

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
        activityStartTime: status.createdAt,
        hasMapData: status.fitness.hasMapData ?? false,
        description: status.fitness.description ?? null,
        deviceManufacturer: status.fitness.deviceManufacturer ?? null,
        deviceName: status.fitness.deviceName ?? null,
        sourceUrl: status.fitness.sourceUrl ?? null
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
    status.fitness?.hasMapData,
    status.fitness?.description,
    status.fitness?.deviceManufacturer,
    status.fitness?.deviceName,
    status.fitness?.sourceUrl
  ])
  const [fitnessFiles, setFitnessFiles] =
    useState<StatusFitnessFileItem[]>(defaultFitnessFiles)
  const [selectedFitnessFileId, setSelectedFitnessFileId] = useState<
    string | null
  >(defaultFitnessFiles[0]?.id ?? null)
  const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
    null
  )
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
  // Every provider renders an interactive map, so route data is loaded whenever
  // there is a fitness file to load it from.
  const shouldLoadInteractiveMap = Boolean(fitness?.id)
  const activityLabel = getActivityLabel(fitness?.activityType ?? undefined)
  // `status.text` holds the post's processed HTML caption, so render the
  // heading as decoded, tag-free plain text rather than raw markup. Falls back
  // to the activity label when the caption is empty/whitespace-only. Memoized
  // because `htmlToPlainText` parses + sanitizes the HTML and this component
  // re-renders frequently (e.g. on chart hover).
  const statusTitle = useMemo(
    () => htmlToPlainText(status.text ?? '') || activityLabel,
    [status.text, activityLabel]
  )
  const activityDate = formatUtcDate(
    fitness?.activityStartTime ?? status.createdAt,
    'p, MMMM d, yyyy'
  )
  const visibilityMeta =
    VISIBILITY_META[getVisibility(status.to, status.cc)] ??
    VISIBILITY_META.public
  const VisibilityIcon = visibilityMeta.icon
  const deviceLabel = getDeviceDisplayLabel(
    fitness?.deviceName,
    fitness?.deviceManufacturer
  )

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
    () => heartRateSeries.filter((bpm) => bpm > 0),
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
  const heartRateChartSeries = useMemo(() => {
    const firstReading = heartRateSeries.find((bpm) => bpm > 0)
    if (firstReading === undefined) return []

    let lastReading = firstReading
    return heartRateSeries.map((bpm) => {
      if (bpm > 0) lastReading = bpm
      return lastReading
    })
  }, [heartRateSeries])

  const heartRateStats = useMemo(() => {
    if (positiveHeartRateSeries.length === 0) return null
    const { maxValue } = getSeriesMinMax(positiveHeartRateSeries)
    const avg = Math.round(
      positiveHeartRateSeries.reduce((a, b) => a + b, 0) /
        positiveHeartRateSeries.length
    )
    return { avg, max: Math.round(maxValue) }
  }, [positiveHeartRateSeries])

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
  const { minValue: elevationMin, maxValue: elevationMax } = useMemo(
    () => getSeriesMinMax(activitySeries.elevation),
    [activitySeries.elevation]
  )
  const { minValue: speedMin, maxValue: speedMax } = useMemo(
    () => getSeriesMinMax(activitySeries.speed),
    [activitySeries.speed]
  )
  const { minValue: powerMin, maxValue: powerMax } = useMemo(
    () => getSeriesMinMax(activitySeries.power),
    [activitySeries.power]
  )
  const { minValue: heartRateMin, maxValue: heartRateMax } = useMemo(
    () => getSeriesMinMax(activitySeries.heartRate),
    [activitySeries.heartRate]
  )
  const highlightedElapsedLabel =
    typeof highlightedElapsedSeconds === 'number'
      ? formatDuration(Math.round(highlightedElapsedSeconds))
      : null

  // Every chart the Analysis section can draw, in display order. `fractionDigits`
  // is the precision of that series' scale labels, reused by the hover readout.
  const analysisCharts = useMemo(
    (): Array<{
      key: AnalysisGraphKey
      /** Long title for the stacked panel row ("Elevation profile"). */
      title: string
      /** Short label for the picker chip and combined-chart legend. */
      label: string
      unit: string
      values: number[]
      minLabel: string
      maxLabel: string
      fractionDigits: number
    }> => [
      {
        key: 'elevation',
        title: 'Elevation profile',
        label: 'Elevation',
        unit: 'm',
        values: activitySeries.elevation,
        minLabel: formatChartValue(elevationMin, 0),
        maxLabel: formatChartValue(elevationMax, 0),
        fractionDigits: 0
      },
      {
        key: 'speed',
        title: 'Speed',
        label: 'Speed',
        unit: 'km/h',
        values: activitySeries.speed,
        minLabel: formatChartValue(speedMin, 1),
        maxLabel: formatChartValue(speedMax, 1),
        fractionDigits: 1
      },
      {
        key: 'power',
        title: 'Power',
        label: 'Power',
        unit: 'w',
        values: activitySeries.power,
        minLabel: formatChartValue(powerMin, 0),
        maxLabel: formatChartValue(powerMax, 0),
        fractionDigits: 0
      },
      {
        key: 'heart-rate',
        title: 'Heart rate',
        label: 'Heart rate',
        unit: 'bpm',
        values: activitySeries.heartRate,
        minLabel: formatChartValue(heartRateMin, 0),
        maxLabel: formatChartValue(heartRateMax, 0),
        fractionDigits: 0
      }
    ],
    [
      activitySeries,
      elevationMax,
      elevationMin,
      heartRateMax,
      heartRateMin,
      powerMax,
      powerMin,
      speedMax,
      speedMin
    ]
  )

  // The charts to draw: those with data whose chip is on, kept in the fixed
  // display order of `analysisCharts` regardless of the order they were toggled.
  // Memoized (independent of the hovered instant) so the combined chart's paths
  // are not rebuilt on every pointer move.
  const visibleAnalysisCharts = useMemo(
    () =>
      analysisCharts.filter(
        (chart) =>
          chart.values.length > 0 && selectedGraphKeys.includes(chart.key)
      ),
    [analysisCharts, selectedGraphKeys]
  )
  const combinedChartSeries = useMemo<CombinedChartSeries[]>(
    () =>
      visibleAnalysisCharts.map((chart) => ({
        key: chart.key,
        label: chart.label,
        unit: chart.unit,
        values: chart.values,
        fractionDigits: chart.fractionDigits
      })),
    [visibleAnalysisCharts]
  )

  const histogramMinutes = useMemo(() => {
    if (powerSeries.length === 0) return []

    // Use the stack-safe helper rather than spreading a long series into
    // Math.max, which can overflow the call stack on large arrays.
    const computedMaxPower = Math.max(
      getSeriesMinMax(powerSeries).maxValue,
      100
    )
    const bucketCount = Math.ceil((computedMaxPower + 25) / 25)

    const buckets = new Array(bucketCount).fill(0)
    // Actual power data represents samples (usually 1 per second)
    for (const p of powerSeries) {
      const bucketIndex = Math.floor(p / 25)
      if (bucketIndex >= 0 && bucketIndex < bucketCount) {
        buckets[bucketIndex] += 1
      }
    }
    // Convert samples (seconds) to minutes
    return buckets.map((seconds) => seconds / 60)
  }, [powerSeries])

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

  // The chips to offer — only series that actually have data. A chip the user
  // toggled off is simply dropped from `visibleAnalysisCharts`, and one whose
  // series is absent from the current file never appears here, so the picker
  // needs no reset effect to recover from an empty selection.
  const analysisGraphOptions = useMemo(() => {
    return ANALYSIS_GRAPH_OPTIONS.filter((option) => {
      if (option.id === 'elevation') return activitySeries.elevation.length > 0
      if (option.id === 'speed') return activitySeries.speed.length > 0
      if (option.id === 'power') return activitySeries.power.length > 0
      if (option.id === 'heart-rate') return activitySeries.heartRate.length > 0
      return true
    })
  }, [activitySeries])

  const hasHeartRate = positiveHeartRateSeries.length > 0
  const hasPower = powerSeries.length > 0
  const hasPhotos = mediaWithoutMap.length > 0
  const hasComments = replies.length > 0 || Boolean(currentActor)
  const hasAnalysisSeries =
    activitySeries.elevation.length > 0 ||
    activitySeries.speed.length > 0 ||
    activitySeries.power.length > 0 ||
    activitySeries.heartRate.length > 0

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

  const isOwner =
    Boolean(status.isLocalActor) && currentActor?.id === status.actorId

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
          and two of that row's overlays are not portalled, so a clip here is a
          clip on both of them. The action-button error tooltips hang below the
          row (`top-full mt-1`) and the row is the last child of the footer's
          `py-2.5`, so a failed delete or like used to render ~6px of a tooltip
          against the bottom border and read as nothing happening at all. The
          edit-history panel opens *upward* from the same row (`bottom-full`,
          ~360px — a 2.5rem header over a `max-h-80` list) over a card body only
          ~230px tall, so the oldest revisions were sliced off the top. Both are
          desktop-only symptoms of the same class the status detail card fixed;
          the ⋯ menu's popover and the reaction picker are unaffected either way
          because they portal to the document body.

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

          <h1
            className="mt-3 text-2xl font-semibold tracking-tight"
            title={statusTitle}
          >
            {statusTitle}
          </h1>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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
          </div>

          {deviceLabel ? (
            <div className="mt-1 text-sm text-muted-foreground">
              Recorded with{' '}
              <BrandedDeviceLink
                deviceName={fitness?.deviceName}
                deviceManufacturer={fitness?.deviceManufacturer}
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

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          </div>

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
              onReply={() => setActiveSection('comments')}
              onShowAttachment={onShowAttachment}
            />
          </div>
        )}
      </div>

      {/* Section sub-navigation */}
      <SectionNav
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {secondaryStats.map((stat) => (
                  <StatTile
                    key={stat.label}
                    icon={stat.icon}
                    label={stat.label}
                    value={stat.value}
                    sub={stat.sub}
                  />
                ))}
              </div>
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

            {!hasAnalysisSeries ? (
              <Card>
                <p className="text-sm text-muted-foreground">
                  {isRouteDataLoading
                    ? 'Loading analysis data…'
                    : (routeDataError ??
                      'No analysis data is available for this activity.')}
                </p>
              </Card>
            ) : (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Graph display
                  </p>
                  {/* Segmented toggle: `separate` stacks each graph, `combined`
                      overlays them in one chart. */}
                  <div
                    role="group"
                    aria-label="Graph display mode"
                    className="inline-flex rounded-lg border bg-muted p-0.5 text-xs font-medium"
                  >
                    {GRAPH_DISPLAY_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={graphDisplayMode === mode.id}
                        onClick={() => setGraphDisplayMode(mode.id)}
                        className={cn(
                          'rounded-md px-3 py-1 transition-colors',
                          graphDisplayMode === mode.id
                            ? 'bg-background text-primary shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {analysisGraphOptions.map((option) => {
                    const isSelected = selectedGraphKeys.includes(option.id)
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleGraphKey(option.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                          isSelected
                            ? cn(
                                ANALYSIS_GRAPH_STYLES[option.id].chipBorder,
                                'text-foreground'
                              )
                            : 'border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            ANALYSIS_GRAPH_STYLES[option.id].dot,
                            !isSelected && 'opacity-40'
                          )}
                        />
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {highlightedElapsedLabel
                    ? `Selected time: ${highlightedElapsedLabel}`
                    : graphDisplayMode === 'combined'
                      ? 'Pick the graphs to overlay in one chart. Hover it to follow that time point on the map.'
                      : 'Pick the graphs to show. Hover any graph to follow that time point on the map.'}
                </p>
              </Card>
            )}

            {/* No chip is on — every graph was toggled off — so there is
                nothing to draw in either mode. */}
            {hasAnalysisSeries && visibleAnalysisCharts.length === 0 && (
              <Card>
                <p className="text-sm text-muted-foreground">
                  Select at least one graph to display.
                </p>
              </Card>
            )}

            {/* Combined: every selected series overlaid in one chart, each
                scaled to its own range. */}
            {graphDisplayMode === 'combined' &&
              combinedChartSeries.length > 0 && (
                <div
                  data-testid="analysis-combined-graph"
                  className="overflow-hidden rounded-xl border bg-background"
                >
                  <CombinedChartPanel
                    series={combinedChartSeries}
                    durationSeconds={durationSeconds}
                    highlightedElapsedSeconds={highlightedElapsedSeconds}
                    onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  />
                </div>
              )}

            {/* Separate: every visible graph shares ONE bordered panel, its rows
                split by a 1px divider and nothing else — so a full selection
                reads as a single table of time-aligned series rather than four
                cards with gaps between them. */}
            {graphDisplayMode === 'separate' &&
              visibleAnalysisCharts.length > 0 && (
                <div
                  data-testid="analysis-graphs"
                  className="overflow-hidden rounded-xl border bg-background"
                >
                  {visibleAnalysisCharts.map((chart, index) => (
                    <div
                      key={chart.key}
                      className={cn(index > 0 && 'border-t')}
                    >
                      <ChartPanel
                        title={chart.title}
                        unit={chart.unit}
                        values={chart.values}
                        strokeClassName={
                          ANALYSIS_GRAPH_STYLES[chart.key].stroke
                        }
                        dotClassName={ANALYSIS_GRAPH_STYLES[chart.key].dot}
                        minLabel={chart.minLabel}
                        maxLabel={chart.maxLabel}
                        fractionDigits={chart.fractionDigits}
                        durationSeconds={durationSeconds}
                        highlightedElapsedSeconds={highlightedElapsedSeconds}
                        onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                      />
                    </div>
                  ))}
                </div>
              )}
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
