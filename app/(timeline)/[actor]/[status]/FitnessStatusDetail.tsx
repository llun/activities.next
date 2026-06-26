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
import { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import {
  type FitnessRouteSample,
  type FitnessRouteSegment,
  type StatusFitnessFileItem,
  getFitnessFilesByStatus,
  getFitnessRouteData
} from '@/lib/client'
import { BrandedDeviceLink } from '@/lib/components/posts/BrandedDeviceLink'
import { BookmarkButton } from '@/lib/components/posts/actions/bookmark-button'
import { LikeButton } from '@/lib/components/posts/actions/like-button'
import { PostMenu } from '@/lib/components/posts/actions/post-menu'
import { ReplyButton } from '@/lib/components/posts/actions/reply-button'
import { RepostButton } from '@/lib/components/posts/actions/repost-button'
import { ActorAvatar } from '@/lib/components/posts/actor'
import { Media } from '@/lib/components/posts/media'
import { Post } from '@/lib/components/posts/post'
import { StatusReplyBox } from '@/lib/components/posts/status-reply-box'
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
import { loadMapboxModule } from '@/lib/utils/mapbox'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

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

interface Props {
  host: string
  mapboxAccessToken?: string
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
type AnalysisGraphFilter = 'all' | AnalysisGraphKey

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

interface MapboxMap {
  addSource: (id: string, source: Record<string, unknown>) => void
  addLayer: (layer: Record<string, unknown>) => void
  once: (event: 'load', listener: () => void) => void
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

interface MapboxModule {
  accessToken: string
  Map: new (options: {
    container: HTMLElement
    style: string
    attributionControl: boolean
  }) => MapboxMap
  LngLatBounds: new (
    sw: [number, number],
    ne: [number, number]
  ) => MapboxLngLatBounds
}

const ANALYSIS_GRAPH_OPTIONS: Array<{
  id: AnalysisGraphFilter
  label: string
}> = [
  { id: 'all', label: 'All graphs' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'speed', label: 'Speed' },
  { id: 'power', label: 'Power' },
  { id: 'heart-rate', label: 'Heart rate' }
]

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
const MAP_ACTIVE_POINT_SOURCE_ID = 'activity-active-point'

const clampNumber = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

const findRouteSampleForElapsed = (
  samples: FitnessRouteSample[],
  elapsedSeconds: number
): FitnessRouteSample | null => {
  if (samples.length === 0) return null
  if (!Number.isFinite(elapsedSeconds)) return null

  let low = 0
  let high = samples.length - 1

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (samples[mid].elapsedSeconds < elapsedSeconds) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  if (low <= 0) return samples[0]

  const candidate = samples[low]
  const previousCandidate = samples[low - 1]

  return Math.abs(previousCandidate.elapsedSeconds - elapsedSeconds) <
    Math.abs(candidate.elapsedSeconds - elapsedSeconds)
    ? previousCandidate
    : candidate
}

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
  const range = Math.max(1, max - min)

  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

const buildXAxisLabels = (
  sampleCount: number,
  durationSeconds: number,
  tickCount = 6
) => {
  const labels: string[] = []
  for (let i = 0; i < tickCount; i++) {
    const ratio = i / (tickCount - 1)
    const seconds = Math.round(ratio * durationSeconds)
    labels.push(formatDuration(seconds))
  }
  return labels
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
          <Button variant="outline" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <ActiveIcon className="size-4 text-primary" />
              {activeTab.label}
            </span>
            <ChevronDown className="ml-2 size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[--radix-dropdown-menu-trigger-width]"
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
                  'flex w-full items-center gap-2',
                  isActive && 'bg-primary/10 font-medium text-primary'
                )}
              >
                <Icon className="size-4" />
                {tab.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

const ElevationProfileChart: FC<{ values: number[]; height?: number }> = ({
  values,
  height = 130
}) => {
  const width = 800
  const { minValue, maxValue } = getSeriesMinMax(values)
  const line = buildChartPath(values, width, height, minValue, maxValue)
  const area = `${line} L ${width.toFixed(2)} ${height} L 0 ${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
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
    </svg>
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
  colorClassName?: string
  values: number[]
  minLabel?: string
  maxLabel?: string
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
  showHoverMessage?: boolean
}> = ({
  title,
  unit,
  values,
  colorClassName,
  minLabel,
  maxLabel,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds,
  showHoverMessage = false
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
    () =>
      durationSeconds ? buildXAxisLabels(values.length, durationSeconds) : null,
    [durationSeconds, values.length]
  )
  const canHoverMapPoint =
    typeof onHighlightElapsedSeconds === 'function' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0 &&
    values.length > 0
  const highlightedIndex =
    canHoverMapPoint && typeof highlightedElapsedSeconds === 'number'
      ? clampNumber(
          Math.round(
            (highlightedElapsedSeconds / durationSeconds) * (values.length - 1)
          ),
          0,
          values.length - 1
        )
      : null
  const highlightedValue =
    typeof highlightedIndex === 'number' ? values[highlightedIndex] : null
  const highlightedX =
    typeof highlightedIndex === 'number'
      ? (highlightedIndex / Math.max(1, values.length - 1)) * width
      : null
  const highlightedY =
    typeof highlightedValue === 'number'
      ? getChartYPosition(highlightedValue, height, minValue, maxValue)
      : null
  const highlightedElapsedLabel =
    typeof highlightedElapsedSeconds === 'number'
      ? formatDuration(Math.round(highlightedElapsedSeconds))
      : null

  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="mb-2 flex items-end justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs tabular-nums text-muted-foreground">
          Scale {minScale} - {maxScale}
        </p>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-stretch gap-2">
        <div
          className={cn(
            'flex flex-col justify-between text-[11px] tabular-nums text-muted-foreground',
            GRAPH_HEIGHT_CLASSNAME
          )}
        >
          <span>{maxScale}</span>
          <span>{minScale}</span>
        </div>
        <div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className={cn(
              'w-full',
              GRAPH_HEIGHT_CLASSNAME,
              canHoverMapPoint && 'cursor-crosshair'
            )}
            onMouseMove={(event) => {
              if (!canHoverMapPoint || !onHighlightElapsedSeconds) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const ratio = clampNumber(
                (event.clientX - bounds.left) / Math.max(bounds.width, 1),
                0,
                1
              )
              onHighlightElapsedSeconds(ratio * durationSeconds)
            }}
            onMouseLeave={() => {
              if (!canHoverMapPoint || !onHighlightElapsedSeconds) return
              onHighlightElapsedSeconds(null)
            }}
          >
            <path
              d={path}
              fill="none"
              className={cn('stroke-[2.5]', colorClassName ?? 'stroke-sky-500')}
            />
            {typeof highlightedX === 'number' &&
            typeof highlightedY === 'number' ? (
              <>
                <line
                  x1={highlightedX}
                  y1={0}
                  x2={highlightedX}
                  y2={height}
                  className="stroke-sky-500 stroke-[1.5] opacity-60"
                />
                <circle
                  cx={highlightedX}
                  cy={highlightedY}
                  r={4.5}
                  className="fill-sky-500 stroke-white stroke-[2]"
                />
              </>
            ) : null}
          </svg>
          {xLabels && (
            <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
              {xLabels.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          )}
          {showHoverMessage ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {highlightedElapsedLabel
                ? `Selected time: ${highlightedElapsedLabel}`
                : 'Hover the chart to follow that time point on the map.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const ActivityMapPanel: FC<{
  mapAttachment?: Attachment
  routeSamples: FitnessRouteSample[]
  routeSegments: FitnessRouteSegment[]
  highlightedElapsedSeconds?: number | null
  mapboxAccessToken?: string
  routeDataError?: string | null
  isRouteDataLoading?: boolean
  onOpenMap?: () => void
}> = ({
  mapAttachment,
  routeSamples,
  routeSegments,
  highlightedElapsedSeconds = null,
  mapboxAccessToken,
  routeDataError = null,
  isRouteDataLoading = false,
  onOpenMap
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)
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

  const shouldRenderInteractiveMap =
    Boolean(mapboxAccessToken) &&
    drawableRouteSegments.length > 0 &&
    !routeDataError &&
    !mapLoadError

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
    if (!shouldRenderInteractiveMap || !mapContainerRef.current) {
      mapRef.current?.remove()
      mapRef.current = null
      return
    }

    let cancelled = false

    const initializeMap = async () => {
      try {
        const mapbox = await loadMapboxModule<MapboxModule>()
        if (cancelled || !mapContainerRef.current) return

        setMapLoadError(null)
        mapbox.accessToken = mapboxAccessToken ?? ''

        const map = new mapbox.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/outdoors-v12',
          attributionControl: false
        })

        mapRef.current = map

        map.once('load', () => {
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

          map.addSource(MAP_ACTIVE_POINT_SOURCE_ID, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            }
          })

          map.addLayer({
            id: 'activity-active-point-ring',
            type: 'circle',
            source: MAP_ACTIVE_POINT_SOURCE_ID,
            paint: {
              'circle-radius': 8,
              'circle-color': '#ffffff',
              'circle-opacity': 0.95
            }
          })

          map.addLayer({
            id: 'activity-active-point-core',
            type: 'circle',
            source: MAP_ACTIVE_POINT_SOURCE_ID,
            paint: {
              'circle-radius': 4.5,
              'circle-color': [
                'case',
                ['==', ['get', 'isHiddenByPrivacy'], true],
                '#16a34a',
                '#1d4ed8'
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
        if (cancelled) return
        mapRef.current?.remove()
        mapRef.current = null
        setMapLoadError('Interactive map unavailable. Using static preview.')
      }
    }

    void initializeMap()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [
    mapboxAccessToken,
    routeFeatureCollection,
    routeSamplesForBounds,
    shouldRenderInteractiveMap
  ])

  useEffect(() => {
    if (!shouldRenderInteractiveMap) return

    const map = mapRef.current
    if (!map) return

    const source = map.getSource(MAP_ACTIVE_POINT_SOURCE_ID) as
      | MapboxGeoJSONSource
      | undefined
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
      {shouldRenderInteractiveMap ? (
        <div ref={mapContainerRef} className="h-full w-full" />
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
        <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/20 text-sm text-muted-foreground">
          Map preview unavailable
        </div>
      )}

      {shouldRenderInteractiveMap ? (
        <>
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
          <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border bg-background/95 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Route className="size-3.5" /> GPS trace
          </div>
          {hasHiddenPrivacySegments ? (
            <div className="absolute bottom-3 left-3 rounded-md border border-green-300 bg-background/95 px-3 py-2 text-xs font-medium text-green-700 shadow-sm dark:border-green-900 dark:text-green-400">
              Green segments are hidden from other viewers
            </div>
          ) : null}
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

      {!shouldRenderInteractiveMap &&
      isRouteDataLoading &&
      mapboxAccessToken ? (
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

export const FitnessStatusDetail: FC<Props> = ({
  host,
  mapboxAccessToken,
  currentTime,
  currentActor,
  status,
  replies = [],
  isMediaUploadEnabled,
  onShowAttachment
}) => {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<SectionKey>('overview')
  const [analysisGraphFilter, setAnalysisGraphFilter] =
    useState<AnalysisGraphFilter>('all')
  // Force-resets the always-on comment composer after a cancel or a post.
  const [composerKey, setComposerKey] = useState(0)

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
  const shouldLoadInteractiveMap = Boolean(mapboxAccessToken && fitness?.id)
  const activityLabel = getActivityLabel(fitness?.activityType ?? undefined)
  // `status.text` holds the post's processed HTML caption, so render the
  // heading as decoded, tag-free plain text rather than raw markup. Falls back
  // to the activity label when the caption is empty/whitespace-only.
  const statusTitle = htmlToPlainText(status.text) || activityLabel
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

  useEffect(() => {
    if (activeSection !== 'analysis') {
      setHighlightedElapsedSeconds(null)
    }
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

  // Heart-rate monitors report 0 bpm during sensor dropouts; exclude those so
  // the avg/max, the Analysis chart, and the zone buckets all agree (unlike
  // power, 0 bpm is never a real reading). Mirrors computeHeartRateZones.
  const positiveHeartRateSeries = useMemo(
    () => heartRateSeries.filter((bpm) => bpm > 0),
    [heartRateSeries]
  )

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
      heartRate:
        positiveHeartRateSeries.length > 0
          ? downsampleSeries(positiveHeartRateSeries, 120)
          : [],
      power: powerSeries.length > 0 ? downsampleSeries(powerSeries, 120) : [],
      speed: speedSeries.length > 0 ? downsampleSeries(speedSeries, 120) : [],
      elevation:
        altitudeSeries.length > 0 ? downsampleSeries(altitudeSeries, 120) : []
    }
  }, [positiveHeartRateSeries, powerSeries, speedSeries, altitudeSeries])
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

  const analysisGraphOptions = useMemo(() => {
    return ANALYSIS_GRAPH_OPTIONS.filter((option) => {
      if (option.id === 'elevation') return activitySeries.elevation.length > 0
      if (option.id === 'speed') return activitySeries.speed.length > 0
      if (option.id === 'power') return activitySeries.power.length > 0
      if (option.id === 'heart-rate') return activitySeries.heartRate.length > 0
      return true
    })
  }, [activitySeries])

  // Reset the graph filter when the selected option no longer has data (e.g.
  // after switching to a file without that series), so Analysis never gets
  // stuck on an empty, removed filter. 'all' is always available.
  useEffect(() => {
    if (
      !analysisGraphOptions.some((option) => option.id === analysisGraphFilter)
    ) {
      setAnalysisGraphFilter('all')
    }
  }, [analysisGraphOptions, analysisGraphFilter])

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

  const sourceHref = fitness?.id
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
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5">
          {sourceHref ? (
            <a
              href={sourceHref}
              className="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
              title={fitness?.fileName}
            >
              <Activity className="size-3.5 shrink-0" />
              <span className="truncate underline decoration-border underline-offset-2">
                {fitness?.fileName}
              </span>
              <span className="shrink-0 uppercase">{fitness?.fileType}</span>
              {fitnessFiles.length > 1 && selectedFileIndex >= 0 ? (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  file {selectedFileIndex + 1} of {fitnessFiles.length}
                </span>
              ) : null}
            </a>
          ) : (
            <span />
          )}
          {currentActor ? (
            <div className="flex items-center gap-0.5 text-muted-foreground">
              <ReplyButton
                status={status}
                onReply={() => setActiveSection('comments')}
              />
              <RepostButton currentActor={currentActor} status={status} />
              <LikeButton currentActor={currentActor} status={status} />
              <BookmarkButton status={status} />
              <PostMenu
                status={status}
                isOwner={isOwner}
                canEdit={false}
                onReply={() => setActiveSection('comments')}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Section sub-navigation */}
      <SectionNav
        tabs={tabs}
        active={activeSection}
        onChange={setActiveSection}
      />

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
                mapboxAccessToken={mapboxAccessToken}
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
                    <span className="text-xs text-muted-foreground">
                      {Math.max(0, Math.round(elevationGainMeters))} m gain
                    </span>
                  }
                >
                  Elevation
                </SectionTitle>
                <ElevationProfileChart values={activitySeries.elevation} />
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
                mapboxAccessToken={mapboxAccessToken}
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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Graph display
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {analysisGraphOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={analysisGraphFilter === option.id}
                      onClick={() => setAnalysisGraphFilter(option.id)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        analysisGraphFilter === option.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {highlightedElapsedLabel
                    ? `Selected time: ${highlightedElapsedLabel}`
                    : 'Hover any graph below to follow that time point on the map.'}
                </p>
              </Card>
            )}

            {(analysisGraphFilter === 'all' ||
              analysisGraphFilter === 'elevation') &&
              activitySeries.elevation.length > 0 && (
                <ChartPanel
                  title="Elevation profile"
                  unit="m"
                  values={activitySeries.elevation}
                  colorClassName="stroke-slate-400"
                  minLabel={elevationMin.toFixed(0)}
                  maxLabel={elevationMax.toFixed(0)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={false}
                />
              )}

            {(analysisGraphFilter === 'all' ||
              analysisGraphFilter === 'speed') &&
              activitySeries.speed.length > 0 && (
                <ChartPanel
                  title="Speed"
                  unit="km/h"
                  values={activitySeries.speed}
                  colorClassName="stroke-sky-500"
                  minLabel={speedMin.toFixed(1)}
                  maxLabel={speedMax.toFixed(1)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={false}
                />
              )}

            {(analysisGraphFilter === 'all' ||
              analysisGraphFilter === 'power') &&
              activitySeries.power.length > 0 && (
                <ChartPanel
                  title="Power"
                  unit="w"
                  values={activitySeries.power}
                  colorClassName="stroke-violet-500"
                  minLabel={powerMin.toFixed(0)}
                  maxLabel={powerMax.toFixed(0)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={false}
                />
              )}

            {(analysisGraphFilter === 'all' ||
              analysisGraphFilter === 'heart-rate') &&
              activitySeries.heartRate.length > 0 && (
                <ChartPanel
                  title="Heart rate"
                  unit="bpm"
                  values={activitySeries.heartRate}
                  colorClassName="stroke-rose-500"
                  minLabel={heartRateMin.toFixed(0)}
                  maxLabel={heartRateMax.toFixed(0)}
                  durationSeconds={durationSeconds}
                  highlightedElapsedSeconds={highlightedElapsedSeconds}
                  onHighlightElapsedSeconds={setHighlightedElapsedSeconds}
                  showHoverMessage={false}
                />
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
