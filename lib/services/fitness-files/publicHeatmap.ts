import {
  RegionBounds,
  deserializeRegions,
  getRegionBounds
} from '@/lib/fitness/regions'
import { TileSegment } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapSegment
} from '@/lib/types/database/fitnessRouteHeatmap'
import { logger } from '@/lib/utils/logger'

/**
 * Drops the `isHiddenByPrivacy` flag from every segment so the public embed
 * renders all routes uniformly.
 *
 * Privacy zones in this app only RECOLOR the trimmed head and tail of each route
 * in the owner's authenticated view — the real coordinates are still present.
 * For a public embed we deliberately do NOT strip those segments (a missing end
 * around home would pinpoint the private location) and do NOT render them in a
 * distinct colour (a highlighted end near home would equally pinpoint it). Flattening
 * the flag makes hidden and visible segments indistinguishable: no hole, no
 * highlight. Bounds are intentionally left untouched for the same reason.
 *
 * DELIBERATE TRADE-OFF (confirmed by the instance owner): the public embed
 * therefore shows full near-home routes, so the home location remains inferable
 * from where routes converge. This is an accepted, owner-chosen behaviour — the
 * owner prefers complete routes with no gaps over clipping near-home points.
 * Do NOT "fix" this by clipping/dropping near-home geometry; that is the very
 * behaviour the owner rejected. (If a future owner wants stronger privacy, clip
 * points within the privacy radius for the public view and recompute bounds.)
 */
export const flattenPrivacySegmentsForPublic = (
  segments: FitnessRouteHeatmapSegment[]
): FitnessRouteHeatmapSegment[] =>
  segments.map((segment) => ({ points: segment.points }))

/**
 * The same flattening for the tile pyramid's segments, which carry the flag as
 * `hidden` and their geometry as flat tile-local integers.
 *
 * It exists beside `flattenPrivacySegmentsForPublic` rather than inside the
 * serving route so the two public surfaces answer to one doctrine: read the
 * comment above for why the geometry stays and only the flag goes. The visit
 * count is not a privacy signal on its own — it says a road was ridden often,
 * not where anyone lives — and dropping it would flatten the map's whole
 * dynamic range, so it rides through.
 */
export const flattenTilePrivacyForPublic = (
  segments: TileSegment[]
): TileSegment[] => segments.map(({ count, points }) => ({ count, points }))

/**
 * Produces the public-safe view of a heatmap for the unauthenticated embed
 * surface: identical to the stored heatmap but with the privacy distinction
 * flattened (see flattenPrivacySegmentsForPublic).
 */
export const toPublicHeatmap = (
  heatmap: FitnessRouteHeatmap
): FitnessRouteHeatmap => ({
  ...heatmap,
  segments: flattenPrivacySegmentsForPublic(heatmap.segments)
})

/**
 * The bounds a SHARED heatmap may be shown within, or null when the share names
 * a region this server cannot resolve — in which case NO public surface may
 * render it.
 *
 * Fails closed, and that is the whole point. `getRegionBounds` answers `[]` for
 * the whole world and for a region string it could not parse a rectangle out
 * of, and `[]` means "clip nothing" everywhere downstream. Only the empty
 * string, the world sentinel `serializeRegions` emits, reaches the unclipped
 * path.
 *
 * A writer really could produce an unresolvable one, which is why this is not
 * merely defensive: `serializeRegions` validated a rectangle BEFORE rounding it
 * to two decimal places, so a box thinner than 0.01° passed and then collapsed,
 * and the token it emitted parses to nothing. The API's `region` parameter
 * accepts higher-precision coordinates by design — its own schema comment says
 * so — so any client sending one stored such a row. Serialization now rejects
 * those, but rows written before it are still out there, and for them the
 * generation job already baked the WHOLE WORLD into `segments`. There is
 * nothing left to clip at that point; refusing to render is the only remedy
 * short of regenerating the row.
 *
 * The refusal would stay regardless. The cost of being wrong is asymmetric: a
 * false refusal costs a share that renders nothing, while a false pass
 * publishes everywhere its owner has ever been.
 */
export const resolveSharedHeatmapRegionBounds = (heatmap: {
  id: string
  actorId: string
  region: string
}): RegionBounds[] | null => {
  const bounds = getRegionBounds(deserializeRegions(heatmap.region))
  if (bounds.length > 0) return bounds
  if (heatmap.region.trim() === '') return []

  // Recorded rather than merely refused: it means "this server cannot read its
  // own stored data", it is permanent for that share, and the owner otherwise
  // sees only a page that will not load with nothing to report.
  logger.warn({
    message: 'Refused a shared route heatmap: its region could not be resolved',
    heatmapId: heatmap.id,
    actorId: heatmap.actorId,
    region: heatmap.region
  })
  return null
}
