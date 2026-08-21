import { FitnessRouteHeatmapData } from '@/lib/client'
import { deserializeRegions, formatRectRegion } from '@/lib/fitness/regions'
import { HeatmapTileSource } from '@/lib/services/fitness-files/heatmapTiles/tileSource'
import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'
import { getMentionFromActorID } from '@/lib/types/domain/actor'

/** Up to two uppercase initials from a display name (falls back to "?"). */
export const computeInitials = (name: string): string => {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Spread to the first full unicode code point so an emoji / non-BMP leading
    // character isn't sliced into a broken surrogate half.
    .map((word) => [...word][0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return initials || '?'
}

/**
 * Absolute "June 24, 2026"-style date for the public "Generated …" line. Pinned
 * to UTC so the rendered date is deterministic regardless of the server's
 * timezone (consistent with the rest of the fitness dashboard).
 */
export const formatGeneratedDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })

/**
 * Link-preview card image size, in the dimensions the image endpoint will
 * actually serve.
 *
 * 1200x600 rather than the 1200x630 the OpenGraph guidance suggests, because
 * that endpoint snaps each axis to its DIMENSION_STEP of 100: asking for 630
 * yields 600 bytes-wise, and a declared height that disagrees with the image is
 * worse than a slightly taller aspect ratio. Both are comfortably over the
 * large-card thresholds (X wants 300x157, Facebook 600x315).
 *
 * The Apple snapshot path is the one renderer whose output differs — it fits
 * into Apple's 640px ceiling and doubles the density, so those bytes are
 * 1280x640. Same 2:1 ratio, and consumers treat these as hints, so the declared
 * pair stays the size that was requested.
 */
export const HEATMAP_CARD_IMAGE_WIDTH = 1200
export const HEATMAP_CARD_IMAGE_HEIGHT = 600

export interface SharedHeatmapOwner {
  name: string
  handle: string
  initials: string
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
   * Static image for the link-preview card. `format=png` is what makes it
   * usable: the keyless renderer answers with SVG, which every card crawler
   * refuses.
   */
  cardImageUrl: string
  /**
   * Map-ready heatmap with the internal generation counters zeroed: as Client
   * Component props they would otherwise be serialised into the public RSC
   * payload on this unauthenticated surface (mirrors the embed page). The public
   * page renders only the map, so no counter is surfaced.
   */
  heatmap: FitnessRouteHeatmapData
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
  /**
   * Tile pyramid to zoom into, or null when there is none. Resolved by the
   * caller, which is the half of this that needs a database.
   */
  tileSource?: HeatmapTileSource | null
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
  token,
  tileSource = null
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

  // Drop any trailing slash so a base like `https://host/` can't yield `//`.
  const base = origin.replace(/\/+$/, '')

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
    publicUrl: `${base}/u/heatmaps/${token}`,
    cardImageUrl:
      `${base}/embed/heatmap/${token}/image` +
      `?w=${HEATMAP_CARD_IMAGE_WIDTH}&h=${HEATMAP_CARD_IMAGE_HEIGHT}&format=png`,
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
      tileSource,
      createdAt: heatmap.createdAt,
      updatedAt: heatmap.updatedAt
    }
  }
}
