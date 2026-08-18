/**
 * Format and density constants for the route heatmap's zoom-tiled pyramid.
 *
 * This module is deliberately dependency-free and carries no `'use client'`
 * directive: the generation job, the serving routes and the map components all
 * import it, and a server module reading a value out of a client module gets
 * nothing (see AGENTS.md → Server/Client Module Boundary). It also reads no
 * environment: the one tunable it consumes, the simplification floor, is passed
 * in as a plain number by whichever server caller resolved it from config.
 */

/**
 * The zoom levels the pyramid stores, coarsest first.
 *
 * Stops at 16 because a z16 pixel is 2.39 m at the equator, which is already at
 * the GPS-noise floor — a finer level would encode jitter rather than road, and
 * every repeat ride would land on slightly different pixels instead of stacking
 * onto shared ones. Steps by 2 rather than 1 because each level costs about a
 * quarter of the one below it, so the whole seven-level ladder is ~1.4x the
 * finest level alone; a step of 1 would nearly double that for detail no
 * viewport asks for (the client rounds a view up to the next stored level).
 */
export const TILE_LADDER_ZOOMS = [4, 6, 8, 10, 12, 14, 16] as const

export const TILE_MIN_ZOOM = TILE_LADDER_ZOOMS[0]
export const TILE_MAX_ZOOM = TILE_LADDER_ZOOMS[TILE_LADDER_ZOOMS.length - 1]

/**
 * Tile-local coordinate space, matching `TILE_SIZE` in `lib/utils/webMercator`
 * so one stored unit is exactly one screen pixel at that zoom. That identity is
 * what makes the whole design work: quantizing to it collapses GPS jitter onto
 * shared edges, so a street ridden fifty times stores one edge with a count of
 * fifty rather than fifty near-miss polylines.
 *
 * Note the space is INCLUSIVE of both ends — a coordinate runs 0..256, which is
 * 257 distinct values, because a point exactly on a tile's far boundary belongs
 * to both that tile (at 256) and its neighbour (at 0). Anything packing a
 * vertex into a single integer must therefore use a base of at least 257; base
 * 256 collides (1,0) with (0,256).
 *
 * There is deliberately NO maximum-points constant anywhere in the tiled path.
 * Tile size is bounded by physical density — a 1-pixel simplification tolerance
 * plus quantized-edge dedup means a tile can only hold as much as the road
 * network inside it — not by an arbitrary budget, so zooming in keeps revealing
 * detail instead of hitting a ceiling.
 */
export const TILE_EXTENT = 256

/**
 * Ramer-Douglas-Peucker tolerance, in pixels at the zoom being built. One pixel
 * is the smallest tolerance that can still change what is drawn: anything finer
 * survives simplification only to be quantized onto the same pixel anyway, so
 * it costs storage and buys nothing.
 */
export const TILE_SIMPLIFY_TOLERANCE_PX = 1

/**
 * How many tiles one serving request may ask for. A bound on request batching
 * only — a viewport needing more tiles issues more requests, and never receives
 * fewer points per tile. Sized so a normal view (~64 tiles when the ladder
 * rounds a zoom up) fits in a single round trip with headroom.
 */
export const MAX_TILES_PER_REQUEST = 128

/**
 * Ground resolution in meters per pixel at a given zoom and latitude — the
 * standard Web Mercator figure: the equatorial circumference (40,075,016.686 m)
 * divided by the 256-pixel world at zoom 0, scaled by cos(latitude) because
 * Mercator stretches east-west away from the equator.
 */
export const EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 = 156_543.03392

export const metersPerPixelAtZoom = (zoom: number, latitude: number) =>
  (EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) /
  2 ** zoom

/**
 * The simplification tolerance to build a zoom at, in meters.
 *
 * Derived from the zoom rather than fixed, which is the whole point of the
 * pyramid: every level is simplified to its own pixel, so precision per screen
 * pixel is constant and no longer falls off as an actor's coverage grows. At
 * the equator that is 9.8 km at z4, 611 m at z8, 38 m at z12 and 2.39 m at z16.
 *
 * `floorMeters` is a floor, not a target — near the poles, or at the finest
 * levels, the per-pixel figure drops below the GPS-noise floor (z16 at 80°N is
 * 0.41 m), and simplifying that finely would preserve jitter as if it were
 * shape.
 */
export const tileToleranceMeters = (
  zoom: number,
  latitude: number,
  floorMeters: number
) =>
  Math.max(
    floorMeters,
    metersPerPixelAtZoom(zoom, latitude) * TILE_SIMPLIFY_TOLERANCE_PX
  )

/**
 * Opacity of a visible route line at a visit count of one. Matches what the
 * untiled heatmap has always drawn, so a regenerated map does not suddenly
 * change tone.
 */
export const HEAT_VISIBLE_BASE_OPACITY = 0.55

/** The same, for the privacy-trimmed class the owner sees in blue. */
export const HEAT_HIDDEN_BASE_OPACITY = 0.4

/**
 * Visit count at which the ramp stops getting hotter. Six passes reach 0.99
 * opacity, so past it the difference is invisible while the numbers keep
 * growing — clamping keeps a commuter's daily street from flattening every
 * other road on the map to nothing.
 */
export const HEAT_COUNT_SATURATION = 6

/**
 * Opacity for a line visited `count` times.
 *
 * `1 - (1 - base)^n` is exactly what stacking n translucent lines at `base`
 * used to produce when the untiled heatmap drew one polyline per activity, so
 * the ramp reproduces the look people already have rather than inventing one —
 * the difference is that the tiled path computes it once from a stored count
 * instead of paying to overdraw n times.
 */
export const heatOpacityForCount = (count: number, base: number) =>
  1 -
  (1 - base) ** Math.min(Math.max(Math.round(count), 1), HEAT_COUNT_SATURATION)
