import {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapSegment
} from '@/lib/types/database/fitnessRouteHeatmap'

/**
 * Drops the `isHiddenByPrivacy` flag from every segment so the public embed
 * renders all routes uniformly.
 *
 * Privacy zones in this app only RECOLOR near-home segments in the owner's
 * authenticated view — the real coordinates are still present. For a public
 * embed we deliberately do NOT strip those segments (a missing donut around
 * home would pinpoint the private location) and do NOT render them in a distinct
 * colour (a highlighted segment near home would equally pinpoint it). Flattening
 * the flag makes hidden and visible segments indistinguishable: no hole, no
 * highlight. Bounds are intentionally left untouched for the same reason.
 */
export const flattenPrivacySegmentsForPublic = (
  segments: FitnessRouteHeatmapSegment[]
): FitnessRouteHeatmapSegment[] =>
  segments.map((segment) => ({ points: segment.points }))

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
