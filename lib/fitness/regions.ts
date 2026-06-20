// Route-heatmap region scoping model.
//
// A heatmap is scoped to an ordered list of regions, where each region is one
// of exactly two kinds:
//   1. Whole world — { type: 'world' } — no clipping, every recorded activity.
//   2. A map rectangle — { type: 'rect', nw, se } — a bounding box defined by
//      two corners: top-left (NW) and bottom-right (SE).
//
// The serialized form is stored in the `region` column of the route-heatmap
// cache (a varchar(255)) and is part of the unique cache key, so it must be
// deterministic and canonical (sorted + deduplicated). Whole-world (and the
// empty list) serialize to '' — the long-standing "no region filter" sentinel.

export interface RegionBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface LatLng {
  lat: number
  lng: number
}

export interface WorldRegion {
  type: 'world'
}

export interface RectRegion {
  type: 'rect'
  /** Optional, UI-only label. Not part of the serialized cache key. */
  name?: string
  /** Top-left corner. */
  nw: LatLng
  /** Bottom-right corner. */
  se: LatLng
}

export type HeatmapRegion = WorldRegion | RectRegion

/**
 * Upper bound on how many regions a single heatmap can be scoped to. Keeps the
 * serialized `region` string within the varchar(255) cache-key column: a single
 * rect token is at most 34 chars (e.g. `rect:-90.00,-180.00,-89.99,-179.99`),
 * so 7 tokens + 6 separators ≤ 244 chars stays safely under the limit.
 */
export const MAX_HEATMAP_REGIONS = 7

/** Fixed coordinate precision for serialization (matches the picker's 0.01 step). */
const COORD_PRECISION = 2

const formatCoord = (value: number): string => {
  const rounded = Number(value.toFixed(COORD_PRECISION))
  // Collapse -0 to 0 so the serialized cache key is stable.
  return (rounded === 0 ? 0 : rounded).toFixed(COORD_PRECISION)
}

const isValidLat = (value: number): boolean =>
  Number.isFinite(value) && value >= -90 && value <= 90

const isValidLng = (value: number): boolean =>
  Number.isFinite(value) && value >= -180 && value <= 180

/**
 * A rectangle is valid when both corners are in range and the top-left corner
 * is genuinely north-west of the bottom-right corner (non-degenerate box).
 * Boxes that cross the antimeridian (±180°) are intentionally unsupported:
 * `nw.lng < se.lng` cannot express a wrapping range, matching the consumer's
 * plain `minLng..maxLng` containment test.
 */
export const isValidRect = (rect: RectRegion): boolean =>
  isValidLat(rect.nw.lat) &&
  isValidLat(rect.se.lat) &&
  isValidLng(rect.nw.lng) &&
  isValidLng(rect.se.lng) &&
  rect.nw.lat > rect.se.lat &&
  rect.nw.lng < rect.se.lng

const rectToken = (rect: RectRegion): string =>
  `rect:${formatCoord(rect.nw.lat)},${formatCoord(rect.nw.lng)},${formatCoord(
    rect.se.lat
  )},${formatCoord(rect.se.lng)}`

/**
 * Serializes a region list into the canonical cache-key string. The whole world
 * (or an empty/all-invalid list) serializes to '' — the world-wide sentinel —
 * because a world region subsumes any drawn rectangles. Rectangle-only lists
 * serialize to a sorted, deduplicated, semicolon-joined list of `rect:` tokens,
 * capped at `MAX_HEATMAP_REGIONS` so the output always fits the varchar(255)
 * cache-key column regardless of the (possibly shorter) input token widths.
 */
export const serializeRegions = (regions: HeatmapRegion[]): string => {
  if (regions.some((region) => region.type === 'world')) return ''
  const tokens = regions
    .filter(
      (region): region is RectRegion =>
        region.type === 'rect' && isValidRect(region)
    )
    .map(rectToken)
  return Array.from(new Set(tokens))
    .sort()
    .slice(0, MAX_HEATMAP_REGIONS)
    .join(';')
}

const parseRectToken = (token: string): RectRegion | null => {
  const parts = token
    .slice('rect:'.length)
    .split(',')
    .map((part) => Number(part))
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null
  }
  const rect: RectRegion = {
    type: 'rect',
    nw: { lat: parts[0], lng: parts[1] },
    se: { lat: parts[2], lng: parts[3] }
  }
  return isValidRect(rect) ? rect : null
}

/**
 * Parses a serialized region string back into a region list. The empty string
 * (the world-wide sentinel) and any list containing the `world` token resolve
 * to a single whole-world region. Unknown or malformed tokens are dropped.
 */
export const deserializeRegions = (serialized: string): HeatmapRegion[] => {
  const trimmed = serialized.trim()
  if (trimmed === '') return [{ type: 'world' }]

  const rects: RectRegion[] = []
  let sawWorld = false
  for (const rawToken of trimmed.split(';')) {
    const token = rawToken.trim()
    if (token === '') continue
    if (token === 'world') {
      sawWorld = true
      continue
    }
    if (token.startsWith('rect:')) {
      const rect = parseRectToken(token)
      if (rect) rects.push(rect)
    }
  }

  if (sawWorld) return [{ type: 'world' }]
  return rects
}

/**
 * Returns the bounding boxes a heatmap should be clipped to. A whole-world (or
 * empty) scope returns [] — the "no clipping" signal the generation job uses to
 * keep every segment.
 */
export const getRegionBounds = (regions: HeatmapRegion[]): RegionBounds[] => {
  if (
    regions.length === 0 ||
    regions.some((region) => region.type === 'world')
  ) {
    return []
  }
  return regions
    .filter((region): region is RectRegion => region.type === 'rect')
    .map((region) => ({
      minLat: region.se.lat,
      maxLat: region.nw.lat,
      minLng: region.nw.lng,
      maxLng: region.se.lng
    }))
}

/** Human-readable summary of a serialized region scope, for list/preview chrome. */
export const describeRegions = (serialized: string): string => {
  const regions = deserializeRegions(serialized)
  if (
    regions.length === 0 ||
    regions.some((region) => region.type === 'world')
  ) {
    return 'Whole world'
  }
  return regions.length === 1 ? '1 map area' : `${regions.length} map areas`
}

export const formatLatitude = (lat: number): string =>
  `${Math.abs(lat).toFixed(COORD_PRECISION)}°${lat >= 0 ? 'N' : 'S'}`

export const formatLongitude = (lng: number): string =>
  `${Math.abs(lng).toFixed(COORD_PRECISION)}°${lng >= 0 ? 'E' : 'W'}`

/** Formats a single rectangle as "TL 52.60°N 5.60°E → BR 52.00°N 6.20°E". */
export const formatRectRegion = (rect: RectRegion): string =>
  `TL ${formatLatitude(rect.nw.lat)} ${formatLongitude(rect.nw.lng)} → ` +
  `BR ${formatLatitude(rect.se.lat)} ${formatLongitude(rect.se.lng)}`
