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
/**
 * Whether both corners are real coordinates.
 *
 * Separate from orientation because a map can hand back a box that is neither:
 * panning past the antimeridian gives unwrapped longitudes (a drag at 2°E on
 * the next copy of the world arrives as 362), which is a perfectly well-drawn
 * box at an impossible coordinate. A surface reporting that as a direction
 * mistake tells the user to reverse corners they did not reverse.
 */
export const isRectInRange = (rect: RectRegion): boolean =>
  isValidLat(rect.nw.lat) &&
  isValidLat(rect.se.lat) &&
  isValidLng(rect.nw.lng) &&
  isValidLng(rect.se.lng)

export const isValidRect = (rect: RectRegion): boolean =>
  isRectInRange(rect) && rect.nw.lat > rect.se.lat && rect.nw.lng < rect.se.lng

/**
 * The same, but allowing a box with no extent — corners the right way round,
 * even if they meet.
 *
 * `isValidRect` folds three different mistakes into one answer: a corner off
 * the globe, dragging from bottom-right to top-left, and dragging a box too
 * small to survive rounding. A surface that has to TELL A USER what went wrong
 * asks the narrower questions instead, because each needs its own sentence.
 */
export const isOrientedRect = (rect: RectRegion): boolean =>
  isRectInRange(rect) &&
  rect.nw.lat >= rect.se.lat &&
  rect.nw.lng <= rect.se.lng

const rectToken = (rect: RectRegion): string =>
  `rect:${formatCoord(rect.nw.lat)},${formatCoord(rect.nw.lng)},${formatCoord(
    rect.se.lat
  )},${formatCoord(rect.se.lng)}`

/**
 * The rectangle as it will be READ BACK after serialization, which is not
 * always the one handed in: `formatCoord` rounds to `COORD_PRECISION`, so a box
 * thinner than 0.01° in either axis collapses onto a single coordinate.
 *
 * Serialization validates THIS rather than the input for that reason. A
 * collapsed box passes `isValidRect` before rounding and fails it after, so it
 * used to be written out as a `rect:` token that `deserializeRegions` then
 * dropped — leaving a region string that reads as a small rectangle and
 * resolves to no bounds, which every consumer takes as WORLD scope. The
 * generation job then built the actor's entire unclipped history under it, and
 * the share page titled that "Map area" (or the owner's saved label): a
 * collapsed token is not the world sentinel, so the page did not call it the
 * world, and it deserializes to no rectangles, so there was no bounding-box
 * caption to contradict that either. Nothing a viewer could see said world.
 * Dropping it here instead makes the scope honestly empty, so the same input
 * serializes to the world sentinel and is labelled "Whole world" wherever it is
 * shown.
 */
const roundTripRect = (rect: RectRegion): RectRegion => ({
  type: 'rect',
  nw: {
    lat: Number(formatCoord(rect.nw.lat)),
    lng: Number(formatCoord(rect.nw.lng))
  },
  se: {
    lat: Number(formatCoord(rect.se.lat)),
    lng: Number(formatCoord(rect.se.lng))
  }
})

/**
 * Whether a rectangle survives serialization AS a rectangle — that is, whether
 * `serializeRegions` will emit a token for it rather than resolving it to the
 * world sentinel.
 *
 * **Anything that PRODUCES a rectangle must gate on this, not on
 * `isValidRect`.** The two answer different questions: `isValidRect` asks
 * whether the box as drawn is well formed, and a box thinner than the
 * serialization step is perfectly well formed while having no canonical key of
 * its own. Saved anyway, it takes the world's key — so every action addressed
 * by that key, including Share, operates on the actor's whole-world heatmap
 * while the row is labelled as a small rectangle.
 *
 * It is also the rule `serializeRegions` itself applies, so a producer and the
 * serializer cannot drift: they are the same function.
 */
export const isSerializableRect = (rect: RectRegion): boolean =>
  // Both before and after rounding. After, for the reason `roundTripRect`
  // gives. Before as well, so the rule can only ever drop a rectangle and never
  // admit one: rounding pulls an out-of-range coordinate back into range (a
  // latitude of 90.004 becomes 90.00), and checking only the rounded box would
  // turn scopes that serialize to the world sentinel today into rect-scoped
  // ones — moving their cache key, and orphaning the heatmap stored under it.
  isValidRect(rect) && isValidRect(roundTripRect(rect))

/**
 * Serializes a region list into the canonical cache-key string. The whole world
 * (or an empty/all-invalid list) serializes to '' — the world-wide sentinel —
 * because a world region subsumes any drawn rectangles. A rectangle too thin to
 * survive rounding counts as invalid and so lands there too, deliberately: see
 * `roundTripRect`. Rectangle-only lists
 * serialize to a sorted, deduplicated, semicolon-joined list of `rect:` tokens,
 * capped at `MAX_HEATMAP_REGIONS` so the output always fits the varchar(255)
 * cache-key column regardless of the (possibly shorter) input token widths.
 */
export const serializeRegions = (regions: HeatmapRegion[]): string => {
  if (regions.some((region) => region.type === 'world')) return ''
  const tokens = regions
    .filter(
      (region): region is RectRegion =>
        region.type === 'rect' && isSerializableRect(region)
    )
    .map(rectToken)
  return Array.from(new Set(tokens))
    .sort()
    .slice(0, MAX_HEATMAP_REGIONS)
    .join(';')
}

/**
 * Serializes a single region into its canonical cache-key string — the form the
 * route-heatmap API keys an individual region's heatmap on. A whole-world region
 * yields '' (the world-wide sentinel); a rectangle yields its lone `rect:` token.
 * This is the per-region counterpart to {@link serializeRegions}, used by the
 * heatmaps UI where each region owns its own heatmap (one kept version each).
 */
export const serializeRegion = (region: HeatmapRegion): string =>
  serializeRegions([region])

const parseRectToken = (token: string): RectRegion | null => {
  const rawParts = token.slice('rect:'.length).split(',')
  // Reject empty/whitespace coordinates explicitly: Number('') and Number(' ')
  // coerce to 0, which would silently parse a malformed token into a valid box.
  if (rawParts.length !== 4 || rawParts.some((part) => part.trim() === '')) {
    return null
  }
  const parts = rawParts.map((part) => Number(part))
  if (parts.some((value) => !Number.isFinite(value))) {
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

/**
 * Canonicalizes a raw `region` request parameter into the exact string the
 * heatmap cache is keyed by: rounded, sorted, and capped to
 * `MAX_HEATMAP_REGIONS`. An absent or empty parameter is world scope, whose
 * canonical form is the empty string.
 *
 * Every surface that accepts a region from a client normalizes with this, so
 * two spellings of one scope cannot address two different cache rows — and, on
 * the tiled path, so the rectangle tiles are clipped to is the same rectangle
 * the stored heatmap was generated for.
 */
export const normalizeRegionParam = (rawRegion?: string | null): string =>
  rawRegion ? serializeRegions(deserializeRegions(rawRegion)) : ''

export const formatLatitude = (lat: number): string =>
  `${Math.abs(lat).toFixed(COORD_PRECISION)}°${lat >= 0 ? 'N' : 'S'}`

export const formatLongitude = (lng: number): string =>
  `${Math.abs(lng).toFixed(COORD_PRECISION)}°${lng >= 0 ? 'E' : 'W'}`

/** Formats a single rectangle as "TL 52.60°N 5.60°E → BR 52.00°N 6.20°E". */
export const formatRectRegion = (rect: RectRegion): string =>
  `TL ${formatLatitude(rect.nw.lat)} ${formatLongitude(rect.nw.lng)} → ` +
  `BR ${formatLatitude(rect.se.lat)} ${formatLongitude(rect.se.lng)}`
