import {
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapSegment
} from '@/lib/types/database/fitnessRouteHeatmap'
import { encodePolyline } from '@/lib/utils/polyline'
import { projectWebMercator } from '@/lib/utils/webMercator'

// A static thumbnail does not need every vertex, so the geometry is downsampled
// hard before encoding. This keeps the Mapbox overlay URL well under the
// provider's 8192-char limit and keeps the SVG fallback small.
const STATIC_IMAGE_POINT_BUDGET = 2000
// Leave headroom in the 8192-char Mapbox URL for the base path, size, padding,
// and access token; spend the rest on `path(...)` overlays.
const MAPBOX_STATIC_URL_BUDGET = 7000
// Cap points per `path(...)` overlay so a single long contiguous route can't
// produce one overlay that alone blows the URL budget (which would drop the
// whole route and silently fall back to the keyless SVG even with a token).
// Long segments are split into multiple overlays instead, sharing an endpoint
// so the rendered line stays continuous.
const MAPBOX_OVERLAY_MAX_POINTS = 120
const ROUTE_COLOR_HEX = 'ef4444'
const SVG_PADDING = 12

export interface StaticHeatmapImageInput {
  segments: FitnessRouteHeatmapSegment[]
  bounds: FitnessRouteHeatmapBounds | null
  width: number
  height: number
}

// Drop non-finite vertices (corrupt GPS / parse artifacts) before encoding or
// projecting — a single NaN/Infinity would corrupt the polyline or the SVG
// bounding box. Segments left with fewer than 2 points are discarded.
const usableSegments = (segments: FitnessRouteHeatmapSegment[]) =>
  segments
    .map((segment) => ({
      ...segment,
      points: segment.points.filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
      )
    }))
    .filter((segment) => segment.points.length >= 2)

// Thin geometry toward `maxPoints` total vertices using a global stride, keeping
// each segment's first and last vertex so routes retain their full extent. A
// local copy of the route-map downsampler so this server module does not import
// the `'use client'` map component.
const downsampleToBudget = (
  segments: FitnessRouteHeatmapSegment[],
  maxPoints: number
): FitnessRouteHeatmapSegment[] => {
  const totalPoints = segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0
  )
  if (totalPoints <= maxPoints) return segments

  const stride = Math.ceil(totalPoints / maxPoints)
  return segments.map((segment) => {
    if (segment.points.length <= 2) return segment

    const points = segment.points.filter((_, index) => index % stride === 0)
    const lastPoint = segment.points[segment.points.length - 1]
    if (points[points.length - 1] !== lastPoint) {
      points.push(lastPoint)
    }
    return { ...segment, points }
  })
}

// Split a point list into chunks of at most `maxPoints`, where each chunk after
// the first repeats the previous chunk's last point so the rendered polylines
// join seamlessly. Chunks shorter than 2 points are dropped.
const chunkPoints = <T>(points: T[], maxPoints: number): T[][] => {
  if (points.length <= maxPoints) return [points]

  const chunks: T[][] = []
  let index = 0
  while (index < points.length - 1) {
    const chunk = points.slice(index, index + maxPoints)
    if (chunk.length >= 2) chunks.push(chunk)
    index += maxPoints - 1
  }
  return chunks
}

/**
 * Builds a Mapbox Static Images API URL that renders the route lines over a
 * light basemap (the "routes over a real map" look). Geometry is encoded as
 * compact `path(...)` polyline overlays, greedily packed until adding the next
 * route would exceed the URL budget (a thumbnail need not show every route).
 *
 * Returns null when there is no usable geometry. The token is embedded in the
 * URL, so callers MUST fetch this server-side and stream the bytes — never hand
 * the URL to the browser.
 *
 * Note: `bounds` (part of the shared input type, used by buildHeatmapSvg) is
 * intentionally ignored here — Mapbox's `/auto/` viewport frames the overlays.
 */
export const buildMapboxStaticUrl = ({
  segments,
  width,
  height,
  token,
  retina = true
}: StaticHeatmapImageInput & {
  token: string
  retina?: boolean
}): string | null => {
  const downsampled = downsampleToBudget(
    usableSegments(segments),
    STATIC_IMAGE_POINT_BUDGET
  )

  // Split long segments into bounded chunks (sharing an endpoint for continuity)
  // so no single overlay can exceed the budget on its own.
  const chunks = downsampled.flatMap((segment) =>
    chunkPoints(segment.points, MAPBOX_OVERLAY_MAX_POINTS)
  )

  const overlays: string[] = []
  let usedLength = 0
  for (const points of chunks) {
    const polyline = encodeURIComponent(encodePolyline(points))
    const overlay = `path-2+${ROUTE_COLOR_HEX}-0.9(${polyline})`
    const addition = overlay.length + (overlays.length > 0 ? 1 : 0)
    if (usedLength + addition > MAPBOX_STATIC_URL_BUDGET) break
    overlays.push(overlay)
    usedLength += addition
  }

  if (overlays.length === 0) return null

  const size = `${Math.round(width)}x${Math.round(height)}${retina ? '@2x' : ''}`
  return (
    `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/` +
    `${overlays.join(',')}/auto/${size}` +
    `?padding=24&access_token=${encodeURIComponent(token)}`
  )
}

const round1 = (value: number) => Math.round(value * 10) / 10

const emptyHeatmapSvg = (width: number, height: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Route heatmap">` +
  `<rect width="100%" height="100%" fill="#f8f9fa"/>` +
  `</svg>`

/**
 * Renders the route lines as a standalone SVG on a plain background — the
 * keyless fallback used when no Mapbox token is configured. Points are projected
 * with Web Mercator and scaled to fit the viewport, so the route shapes match
 * what the interactive map shows (minus the basemap).
 */
export const buildHeatmapSvg = ({
  segments,
  bounds,
  width,
  height
}: StaticHeatmapImageInput): string => {
  const downsampled = downsampleToBudget(
    usableSegments(segments),
    STATIC_IMAGE_POINT_BUDGET * 3
  )
  if (!bounds || downsampled.length === 0) {
    return emptyHeatmapSvg(width, height)
  }

  // Project to an absolute Mercator plane (north maps to smaller y, so no flip),
  // then fit the projected bounding box into the padded viewport.
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const projected = downsampled.map((segment) =>
    segment.points.map((point) => {
      const { x, y } = projectWebMercator(point, 0)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      return { x, y }
    })
  )

  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  const innerWidth = Math.max(width - 2 * SVG_PADDING, 1)
  const innerHeight = Math.max(height - 2 * SVG_PADDING, 1)
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY)
  const offsetX = SVG_PADDING + (innerWidth - spanX * scale) / 2
  const offsetY = SVG_PADDING + (innerHeight - spanY * scale) / 2

  const polylines = projected
    .map((points) => {
      const coords = points
        .map(
          ({ x, y }) =>
            `${round1((x - minX) * scale + offsetX)},${round1((y - minY) * scale + offsetY)}`
        )
        .join(' ')
      return `<polyline points="${coords}" fill="none" stroke="#${ROUTE_COLOR_HEX}" stroke-width="1.4" stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Route heatmap">` +
    `<rect width="100%" height="100%" fill="#f8f9fa"/>` +
    polylines +
    `</svg>`
  )
}
