import crypto from 'node:crypto'

import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'
import { encodePolyline } from '@/lib/utils/polyline'

// Apple Web Snapshots endpoint. The full URL carries the team/key identifiers
// and an ES256 signature, so it MUST only ever be fetched server-side (same
// caution as buildMapboxStaticUrl) — never hand a signed snapshot URL to the
// browser.
const SNAPSHOT_HOST = 'https://snapshot.apple-mapkit.com'
const SNAPSHOT_PATH = '/api/v1/snapshot'

// Apple answers with HTTP 413 once the request URL grows too long, so the whole
// route is re-simplified at a coarser fidelity until the URL fits this budget.
const SNAPSHOT_URL_BUDGET = 4500
// `&signature=<base64url ES256>` is appended after the budget check, so reserve
// room for it (11 chars + 86 chars of base64url for a P-256 r||s signature).
const SIGNATURE_RESERVE = 128
// Vertex budgets tried in order, finest first. A static thumbnail does not need
// every vertex, and the whole route must always be drawn — so when a rung's URL
// overflows we coarsen the simplification of the ENTIRE route rather than
// dropping its tail (which would leave `center=auto` framing only the first part
// of the ride). At ~6.4 URL chars per encoded vertex, ~650 vertices is the
// practical ceiling, so the finest rungs mostly serve short routes.
const POINT_BUDGET_LADDER = [2000, 1200, 800, 500, 320, 200, 120, 80]
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
// Longest team/key identifier we budget for (Apple issues 10-character ids).
const CREDENTIAL_LENGTH_ALLOWANCE = 16
// URL characters kept aside for the encoded polylines themselves. Encoded
// vertices cost ~6.4 chars each, so this carries ~110 vertices — enough for the
// coarsest rungs of the ladder to draw every overlay's 2-point floor plus some
// shape.
const VERTEX_CHAR_RESERVE = 700

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

// Structural (zero-vertex) cost of an overlay once the overlay array has been
// JSON.stringify'd and percent-encoded into the query string. Measured, not
// guessed: one empty overlay costs 148 chars and every additional one costs 145
// (the JSON braces/keys plus `%22`/`%2C` escapes). Derive it here so a change to
// the overlay shape (colour, width, extra key) re-measures itself.
const measureEncodedOverlays = (count: number): number =>
  encodeURIComponent(
    JSON.stringify(
      Array.from({ length: count }, () => ({
        type: 'polyline',
        points: '',
        strokeColor: ROUTE_COLOR_HEX,
        strokeOpacity: ROUTE_STROKE_OPACITY,
        lineWidth: ROUTE_LINE_WIDTH
      }))
    )
  ).length

const OVERLAY_STRUCTURAL_COST =
  measureEncodedOverlays(2) - measureEncodedOverlays(1)

// Everything in the signed URL that is not an overlay: host, the fixed query
// parameters at their worst-case sizes, the empty overlay array, and the
// signature that is appended after the budget check.
const FIXED_URL_OVERHEAD =
  SNAPSHOT_HOST.length +
  buildPath({
    overlays: [],
    width: APPLE_SNAPSHOT_MAX_DIMENSION,
    height: APPLE_SNAPSHOT_MAX_DIMENSION,
    scale: 3,
    teamId: 'X'.repeat(CREDENTIAL_LENGTH_ALLOWANCE),
    keyId: 'X'.repeat(CREDENTIAL_LENGTH_ALLOWANCE)
  }).length +
  SIGNATURE_RESERVE

/**
 * Hard ceiling on the number of polyline overlays a snapshot URL can carry.
 *
 * Each overlay costs ~145 URL characters of pure structure before a single
 * coordinate is encoded, and only ~4,220 characters remain once the host, fixed
 * query parameters and signature are accounted for. Reserving
 * {@link VERTEX_CHAR_RESERVE} characters for the geometry leaves room for ~24
 * overlays.
 *
 * This matters because a region heatmap aggregates one segment per imported
 * activity, and simplification can never take a segment below 2 points — so its
 * overlay count is bounded below by its segment count. Such inputs are infeasible
 * at ANY fidelity, and the ladder below cannot rescue them (`simplifySegments`
 * stops coarsening once every segment is at that 2-point floor, so every rung
 * would recompute the same over-budget geometry).
 */
export const MAX_SNAPSHOT_OVERLAYS = Math.floor(
  (SNAPSHOT_URL_BUDGET - FIXED_URL_OVERHEAD - VERTEX_CHAR_RESERVE) /
    OVERLAY_STRUCTURAL_COST
)

/**
 * Builds the unsigned path + query of an Apple Web Snapshot request that draws
 * the route lines over an Apple basemap. Geometry is simplified
 * (Douglas–Peucker) and encoded as Google Encoded Polylines inside `overlays`.
 *
 * The whole route is always drawn: {@link POINT_BUDGET_LADDER} is walked from
 * the finest vertex budget down, and for each rung EVERY chunk of EVERY segment
 * is encoded and the complete URL measured. The first rung whose signed URL fits
 * {@link SNAPSHOT_URL_BUDGET} wins. Overlays are never dropped — doing so would
 * discard the tail of the ride and make `center=auto` frame only its beginning.
 *
 * Inputs with more than {@link MAX_SNAPSHOT_OVERLAYS} usable segments (e.g. a
 * region heatmap aggregating dozens of rides) are rejected up front, before any
 * simplification runs: each segment always yields at least one overlay, so their
 * URL is over budget at every rung and running the ladder would only burn CPU on
 * this anonymous endpoint. Segments are never merged — a heatmap's segments are
 * disjoint rides, and joining them would draw lines between unrelated activities.
 *
 * Returns null when there is no usable geometry, when there are too many
 * segments, or when even the coarsest rung overflows the budget (callers then
 * fall back to the OSM tile renderer / SVG heatmap). The
 * caller signs the returned path with {@link signAppleSnapshotPath}; the signed
 * URL embeds the developer credentials, so callers MUST fetch it server-side and
 * stream the bytes — never hand the URL to the browser.
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

  const usable = usableSegments(input.segments)
  if (usable.length === 0) return null
  // Minimum possible overlay count: simplification never takes a segment below
  // 2 points, so it can only ever grow (chunking) from here.
  if (usable.length > MAX_SNAPSHOT_OVERLAYS) return null

  for (const pointBudget of POINT_BUDGET_LADDER) {
    const simplified = simplifySegmentsToBudget(
      usable,
      pointBudget,
      BASE_TOLERANCE_METERS
    )
    const chunks = simplified.flatMap((segment) =>
      chunkPoints(segment.points, OVERLAY_MAX_POINTS)
    )
    if (chunks.length === 0) continue
    // Chunking a long contiguous route can still overflow the overlay ceiling at
    // a fine rung; a coarser one will produce fewer chunks.
    if (chunks.length > MAX_SNAPSHOT_OVERLAYS) continue

    const overlays: PolylineOverlay[] = chunks.map((points) => ({
      type: 'polyline',
      points: encodePolyline(points),
      strokeColor: ROUTE_COLOR_HEX,
      strokeOpacity: ROUTE_STROKE_OPACITY,
      lineWidth: ROUTE_LINE_WIDTH
    }))
    const path = buildPath({ overlays, width, height, scale, teamId, keyId })
    if (
      SNAPSHOT_HOST.length + path.length + SIGNATURE_RESERVE <=
      SNAPSHOT_URL_BUDGET
    ) {
      return path
    }
  }

  return null
}

// Parsing a PEM into a KeyObject is CPU-heavy and the key only changes when the
// deployment config does, so memoize it — bulk map regeneration signs one
// snapshot per status.
let cachedKeyPem: string | null = null
let cachedKeyObject: crypto.KeyObject | null = null

const loadPrivateKey = (normalizedKey: string): crypto.KeyObject => {
  if (cachedKeyObject && cachedKeyPem === normalizedKey) return cachedKeyObject
  const key = crypto.createPrivateKey(normalizedKey)
  cachedKeyPem = normalizedKey
  cachedKeyObject = key
  return key
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
    key: loadPrivateKey(normalizedKey),
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
