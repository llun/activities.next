import crypto from 'node:crypto'

import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'
import { encodePolyline } from '@/lib/utils/polyline'

// Apple Web Snapshots endpoint. The full URL carries the team/key identifiers
// and an ES256 signature, so it MUST only ever be fetched server-side (same
// caution as buildMapboxStaticUrl) — never hand a signed snapshot URL to the
// browser.
const SNAPSHOT_HOST = 'https://snapshot.apple-mapkit.com'
const SNAPSHOT_PATH = '/api/v1/snapshot'

// Apple answers with HTTP 413 once the request URL grows too long, so the
// overlays are packed greedily until this budget is reached.
const SNAPSHOT_URL_BUDGET = 4500
// `&signature=<base64url ES256>` is appended after the budget check, so reserve
// room for it (11 chars + 86 chars of base64url for a P-256 r||s signature).
const SIGNATURE_RESERVE = 128
// A static thumbnail does not need every vertex.
const SNAPSHOT_POINT_BUDGET = 2000
// Finest Douglas-Peucker tolerance; coarsened automatically when the route does
// not fit the point budget.
const BASE_TOLERANCE_METERS = 2
// Cap points per overlay so one long contiguous route cannot produce a single
// overlay that alone blows the URL budget. Chunks share an endpoint so the
// rendered line stays continuous.
const OVERLAY_MAX_POINTS = 120
const ROUTE_COLOR_HEX = 'ef4444'
const ROUTE_STROKE_OPACITY = 0.9
const ROUTE_LINE_WIDTH = 4

// Apple clamps each snapshot dimension into this range (before `scale`).
export const APPLE_SNAPSHOT_MIN_DIMENSION = 50
export const APPLE_SNAPSHOT_MAX_DIMENSION = 640

// Bound the upstream fetch so a slow provider cannot hold the request open.
const SNAPSHOT_FETCH_TIMEOUT_MS = 5000

export type AppleSnapshotScale = 1 | 2 | 3

interface AppleSnapshotPoint {
  lat: number
  lng: number
}

interface AppleSnapshotSegment {
  points: AppleSnapshotPoint[]
}

export interface AppleSnapshotInput {
  segments: AppleSnapshotSegment[]
  width: number
  height: number
  scale?: AppleSnapshotScale
}

export interface AppleSnapshotIdentity {
  teamId: string
  keyId: string
}

export interface AppleSnapshotCredentials extends AppleSnapshotIdentity {
  privateKey: string
}

interface PolylineOverlay {
  type: 'polyline'
  points: string
  strokeColor: string
  strokeOpacity: number
  lineWidth: number
}

// Drop non-finite vertices (corrupt GPS / parse artifacts) before encoding — a
// single NaN would corrupt the polyline. Segments left with fewer than 2 points
// are discarded.
const usableSegments = (
  segments: AppleSnapshotSegment[]
): AppleSnapshotSegment[] =>
  segments
    .map((segment) => ({
      points: segment.points.filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
      )
    }))
    .filter((segment) => segment.points.length >= 2)

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

const clampDimension = (value: number): number => {
  if (!Number.isFinite(value)) return APPLE_SNAPSHOT_MIN_DIMENSION
  return Math.min(
    APPLE_SNAPSHOT_MAX_DIMENSION,
    Math.max(APPLE_SNAPSHOT_MIN_DIMENSION, Math.round(value))
  )
}

const clampScale = (scale?: AppleSnapshotScale): AppleSnapshotScale => {
  if (scale === 1 || scale === 2 || scale === 3) return scale
  return 1
}

const buildPath = ({
  overlays,
  width,
  height,
  scale,
  teamId,
  keyId
}: {
  overlays: PolylineOverlay[]
  width: number
  height: number
  scale: AppleSnapshotScale
  teamId: string
  keyId: string
}): string =>
  `${SNAPSHOT_PATH}?center=auto` +
  `&size=${width}x${height}` +
  `&scale=${scale}` +
  `&overlays=${encodeURIComponent(JSON.stringify(overlays))}` +
  `&teamId=${encodeURIComponent(teamId)}` +
  `&keyId=${encodeURIComponent(keyId)}`

/**
 * Builds the unsigned path + query of an Apple Web Snapshot request that draws
 * the route lines over an Apple basemap. Geometry is simplified (Douglas–Peucker)
 * and encoded as Google Encoded Polylines inside `overlays`, greedily packed
 * until adding the next chunk would exceed the URL budget (Apple answers 413 on
 * overflow; a thumbnail need not show every vertex).
 *
 * Returns null when there is no usable geometry. The caller signs the returned
 * path with {@link signAppleSnapshotPath}; the signed URL embeds the developer
 * credentials, so callers MUST fetch it server-side and stream the bytes —
 * never hand the URL to the browser.
 */
export const buildAppleSnapshotPath = (
  input: AppleSnapshotInput,
  credentials: AppleSnapshotIdentity
): string | null => {
  const { teamId, keyId } = credentials
  if (!teamId || !keyId) return null

  const width = clampDimension(input.width)
  const height = clampDimension(input.height)
  const scale = clampScale(input.scale)

  const simplified = simplifySegmentsToBudget(
    usableSegments(input.segments),
    SNAPSHOT_POINT_BUDGET,
    BASE_TOLERANCE_METERS
  )
  const chunks = simplified.flatMap((segment) =>
    chunkPoints(segment.points, OVERLAY_MAX_POINTS)
  )

  const overlays: PolylineOverlay[] = []
  for (const points of chunks) {
    const candidate = [
      ...overlays,
      {
        type: 'polyline' as const,
        points: encodePolyline(points),
        strokeColor: ROUTE_COLOR_HEX,
        strokeOpacity: ROUTE_STROKE_OPACITY,
        lineWidth: ROUTE_LINE_WIDTH
      }
    ]
    const path = buildPath({
      overlays: candidate,
      width,
      height,
      scale,
      teamId,
      keyId
    })
    if (
      SNAPSHOT_HOST.length + path.length + SIGNATURE_RESERVE >
      SNAPSHOT_URL_BUDGET
    ) {
      break
    }
    overlays.push(candidate[candidate.length - 1])
  }

  if (overlays.length === 0) return null

  return buildPath({ overlays, width, height, scale, teamId, keyId })
}

/**
 * Sign an Apple Web Snapshot path with the MapKit private key and return the
 * full URL.
 *
 * The signed payload is the path + query exactly as it will be requested
 * (everything after the host, including `teamId`/`keyId`), and `&signature=`
 * must be the FINAL query parameter — Apple returns 401 otherwise. This is a raw
 * ES256 `r||s` signature (`ieee-p1363`), not a JWT.
 */
export const signAppleSnapshotPath = (
  path: string,
  privateKey: string
): string => {
  // Be defensive: accept a single-line, `\n`-escaped PEM as well as a real
  // multi-line one (getMapProviderConfig already expands the escaped form).
  const normalizedKey = privateKey.replace(/\\n/g, '\n')
  const signature = crypto.sign('sha256', Buffer.from(path), {
    key: crypto.createPrivateKey(normalizedKey),
    dsaEncoding: 'ieee-p1363'
  })

  return `${SNAPSHOT_HOST}${path}&signature=${signature.toString('base64url')}`
}

/**
 * Build, sign, and fetch an Apple Web Snapshot server-side. Resolves to the
 * image bytes, or null when there is no usable geometry or the request fails.
 */
export const fetchAppleSnapshot = async (
  input: AppleSnapshotInput,
  credentials: AppleSnapshotCredentials
): Promise<Buffer | null> => {
  const path = buildAppleSnapshotPath(input, credentials)
  if (!path) return null

  try {
    const url = signAppleSnapshotPath(path, credentials.privateKey)
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(SNAPSHOT_FETCH_TIMEOUT_MS)
    })

    // Pin the upstream payload to an image; release an un-consumed body so
    // undici does not retain the socket until GC.
    const contentType = upstream.headers.get('content-type')
    if (!upstream.ok || !contentType?.startsWith('image/')) {
      await upstream.body?.cancel().catch(() => {})
      return null
    }

    return Buffer.from(await upstream.arrayBuffer())
  } catch {
    return null
  }
}
