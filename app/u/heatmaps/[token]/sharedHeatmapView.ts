import { FitnessRouteHeatmapData } from '@/lib/client'
import { deserializeRegions, formatRectRegion } from '@/lib/fitness/regions'
import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'
import { getMentionFromActorID } from '@/lib/types/domain/actor'

const numberFormatter = new Intl.NumberFormat()

/** "All activities" or a humanised activity type (e.g. "Trail Run"). */
export const formatActivityLabel = (type?: string | null): string =>
  type
    ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'All activities'

/** "All time" for the all-time period, otherwise the raw period key. */
export const formatPeriodLabel = (
  periodType: string,
  periodKey: string
): string => (periodType === 'all_time' ? 'All time' : periodKey)

/** Up to two uppercase initials from a display name (falls back to "?"). */
export const computeInitials = (name: string): string => {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return initials || '?'
}

/** Absolute "June 24, 2026"-style date for the public "Generated …" line. */
export const formatGeneratedDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

export interface SharedHeatmapOwner {
  name: string
  handle: string
  initials: string
}

export interface SharedHeatmapStats {
  routes: string
  activity: string
  period: string
}

export interface SharedHeatmapView {
  title: string
  isWorld: boolean
  /** Single-rect bounding-box caption, omitted for world or multi-rect scopes. */
  bboxLabel?: string
  owner: SharedHeatmapOwner
  generatedLabel: string
  publicUrl: string
  /**
   * Map-ready heatmap with the internal generation counters zeroed: as Client
   * Component props they would otherwise be serialised into the public RSC
   * payload on this unauthenticated surface (mirrors the embed page). Only the
   * route count is surfaced — and only as a pre-formatted stat string below.
   */
  heatmap: FitnessRouteHeatmapData
  stats: SharedHeatmapStats
}

interface BuildSharedHeatmapViewParams {
  /** Privacy-flattened heatmap (see toPublicHeatmap). Real counters intact. */
  heatmap: FitnessRouteHeatmap
  /** Owner display fields; null when the actor could not be resolved. */
  owner: { name?: string; username: string; domain: string } | null
  /** Owner-assigned region label (e.g. "Netherlands"); world is never named. */
  regionName?: string
  /** Canonical origin for the public URL (the actor's own domain). */
  origin: string
  token: string
}

/**
 * Builds the read-only view model for the public shared heatmap page from a
 * completed, privacy-flattened heatmap and its owner. Pure so it can be unit
 * tested without rendering the async server page.
 */
export const buildSharedHeatmapView = ({
  heatmap,
  owner,
  regionName,
  origin,
  token
}: BuildSharedHeatmapViewParams): SharedHeatmapView => {
  const isWorld = heatmap.region === ''
  const title = isWorld ? 'Whole world' : regionName?.trim() || 'Map area'

  const regions = isWorld ? [] : deserializeRegions(heatmap.region)
  const bboxLabel =
    regions.length === 1 && regions[0].type === 'rect'
      ? formatRectRegion(regions[0])
      : undefined

  const ownerName = owner?.name?.trim() || owner?.username?.trim() || 'Athlete'
  const handle = owner
    ? `@${owner.username}@${owner.domain}`
    : getMentionFromActorID(heatmap.actorId, true)

  return {
    title,
    isWorld,
    bboxLabel,
    owner: {
      name: ownerName,
      handle,
      initials: computeInitials(ownerName)
    },
    generatedLabel: formatGeneratedDate(heatmap.updatedAt),
    // Drop any trailing slash so a base like `https://host/` can't yield `//`.
    publicUrl: `${origin.replace(/\/+$/, '')}/u/heatmaps/${token}`,
    heatmap: {
      id: heatmap.id,
      activityType: heatmap.activityType,
      periodType: heatmap.periodType,
      periodKey: heatmap.periodKey,
      region: heatmap.region,
      status: heatmap.status,
      bounds: heatmap.bounds ?? null,
      segments: heatmap.segments,
      activityCount: 0,
      pointCount: 0,
      totalCount: 0,
      cursorOffset: 0,
      isPartial: false,
      createdAt: heatmap.createdAt,
      updatedAt: heatmap.updatedAt
    },
    stats: {
      routes: numberFormatter.format(Math.max(0, heatmap.activityCount)),
      activity: formatActivityLabel(heatmap.activityType),
      period: formatPeriodLabel(heatmap.periodType, heatmap.periodKey)
    }
  }
}
