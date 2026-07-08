import crypto from 'node:crypto'

import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'
import { encodePolyline } from '@/lib/utils/polyline'

import {
  MAX_SNAPSHOT_OVERLAYS,
  buildAppleSnapshotPath,
  fetchAppleSnapshot,
  signAppleSnapshotPath
} from './appleMapsSnapshot'

type SimplifyRouteModule =
  typeof import('@/lib/services/fitness-files/simplifyRoute')

vi.mock('@/lib/services/fitness-files/simplifyRoute', async () => {
  const actual = await vi.importActual<SimplifyRouteModule>(
    '@/lib/services/fitness-files/simplifyRoute'
  )
  return {
    MAX_BUDGET_PASSES: actual.MAX_BUDGET_PASSES,
    totalPointCount: vi.fn(actual.totalPointCount),
    everySegmentAtMinimum: vi.fn(actual.everySegmentAtMinimum),
    simplifyPoints: vi.fn(actual.simplifyPoints),
    simplifySegments: vi.fn(actual.simplifySegments),
    simplifySegmentsToBudget: vi.fn(actual.simplifySegmentsToBudget)
  }
})

const SNAPSHOT_HOST = 'https://snapshot.apple-mapkit.com'
const URL_BUDGET = 4500

const credentials = { teamId: 'TEAM123', keyId: 'KEY456' }

const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const privateKeyPem = keyPair.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()

const route = (points: { lat: number; lng: number }[]) => ({ points })

const straightRoute = [
  route([
    { lat: 37.78, lng: -122.42 },
    { lat: 37.79, lng: -122.41 }
  ])
]

// A dense, wiggly route: Douglas-Peucker cannot collapse it to its endpoints, so
// the URL budget actually has to do work.
const denseRoute = [
  route(
    Array.from({ length: 6000 }, (_, index) => ({
      lat: 52.1 + index * 0.0005 + (index % 2 === 0 ? 0.0004 : 0),
      lng: 5.1 + index * 0.0005 + (index % 3 === 0 ? 0.0004 : 0)
    }))
  )
]

// A long, curvy ride: at the finest rung of the fidelity ladder it still holds
// far more vertices than the URL budget can carry, so the builder must coarsen
// the whole route instead of dropping its tail.
const longRide = [
  route(
    Array.from({ length: 6000 }, (_, index) => {
      const progress = index / 6000
      return {
        lat:
          52.1 +
          Math.sin(progress * 12) * 0.05 +
          Math.sin(index * 0.7) * 0.00008 +
          progress * 0.1,
        lng:
          5.1 +
          Math.cos(progress * 9) * 0.06 +
          Math.cos(index * 0.9) * 0.00008 +
          progress * 0.12
      }
    })
  )
]

const queryParams = (path: string) =>
  new URLSearchParams(path.slice(path.indexOf('?') + 1))

// Inverse of encodePolyline (precision 5); the module only ships an encoder.
const decodePolyline = (encoded: string): { lat: number; lng: number }[] => {
  const points: { lat: number; lng: number }[] = []
  let index = 0
  let lat = 0
  let lng = 0

  const readValue = () => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < encoded.length) {
    lat += readValue()
    lng += readValue()
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

const overlaysOf = (path: string) =>
  JSON.parse(queryParams(path).get('overlays') as string) as PolylineOverlay[]

const boundsOf = (points: { lat: number; lng: number }[]) => ({
  minLat: Math.min(...points.map((point) => point.lat)),
  maxLat: Math.max(...points.map((point) => point.lat)),
  minLng: Math.min(...points.map((point) => point.lng)),
  maxLng: Math.max(...points.map((point) => point.lng))
})

interface PolylineOverlay {
  type: string
  points: string
  strokeColor: string
  strokeOpacity: number
  lineWidth: number
}

describe('buildAppleSnapshotPath', () => {
  it('builds a snapshot path with an auto centre, credentials and polyline overlays', () => {
    const path = buildAppleSnapshotPath(
      { segments: straightRoute, width: 640, height: 480, scale: 2 },
      credentials
    )

    expect(path).not.toBeNull()
    expect(path?.startsWith('/api/v1/snapshot?')).toBe(true)

    const params = queryParams(path as string)
    expect(params.get('center')).toBe('auto')
    expect(params.get('size')).toBe('640x480')
    expect(params.get('scale')).toBe('2')
    expect(params.get('teamId')).toBe('TEAM123')
    expect(params.get('keyId')).toBe('KEY456')

    const overlays = JSON.parse(
      params.get('overlays') as string
    ) as PolylineOverlay[]
    expect(overlays).toHaveLength(1)
    expect(overlays[0]).toEqual({
      type: 'polyline',
      points: encodePolyline(straightRoute[0].points),
      strokeColor: 'ef4444',
      strokeOpacity: 0.9,
      lineWidth: 4
    })
  })

  it.each([
    {
      description: 'no segments at all',
      segments: []
    },
    {
      description: 'a segment with a single point',
      segments: [route([{ lat: 37.78, lng: -122.42 }])]
    },
    {
      description: 'only non-finite vertices',
      segments: [
        route([
          { lat: Number.NaN, lng: -122.42 },
          { lat: 37.79, lng: Number.POSITIVE_INFINITY }
        ])
      ]
    }
  ])('returns null for $description', ({ segments }) => {
    expect(
      buildAppleSnapshotPath({ segments, width: 640, height: 480 }, credentials)
    ).toBeNull()
  })

  it('returns null without simplifying when there are too many segments', () => {
    vi.mocked(simplifySegmentsToBudget).mockClear()

    const manySegments = Array.from({ length: 50 }, (_, index) =>
      route([
        { lat: 52.1 + index * 0.01, lng: 5.1 + index * 0.01 },
        { lat: 52.11 + index * 0.01, lng: 5.11 + index * 0.01 },
        { lat: 52.12 + index * 0.01, lng: 5.13 + index * 0.01 }
      ])
    )

    expect(
      buildAppleSnapshotPath(
        { segments: manySegments, width: 640, height: 480 },
        credentials
      )
    ).toBeNull()
    expect(vi.mocked(simplifySegmentsToBudget)).not.toHaveBeenCalled()
  })

  it('still builds a path for a feasible multi-segment route', () => {
    const fewSegments = Array.from({ length: 3 }, (_, index) =>
      route([
        { lat: 52.1 + index * 0.01, lng: 5.1 + index * 0.01 },
        { lat: 52.11 + index * 0.01, lng: 5.11 + index * 0.01 },
        { lat: 52.12 + index * 0.01, lng: 5.13 + index * 0.01 }
      ])
    )

    const path = buildAppleSnapshotPath(
      { segments: fewSegments, width: 640, height: 480 },
      credentials
    )

    expect(path).not.toBeNull()
    expect(overlaysOf(path as string)).toHaveLength(3)
    expect(MAX_SNAPSHOT_OVERLAYS).toBeGreaterThanOrEqual(3)
  })

  it.each([
    { description: 'a width above the maximum', width: 1200, expected: '640x' },
    { description: 'a width below the minimum', width: 10, expected: '50x' }
  ])('clamps $description into Apple range', ({ width, expected }) => {
    const path = buildAppleSnapshotPath(
      { segments: straightRoute, width, height: 480 },
      credentials
    )

    expect(
      queryParams(path as string)
        .get('size')
        ?.startsWith(expected)
    ).toBe(true)
  })

  it('keeps the signed URL under the Apple length budget for a large route', () => {
    const path = buildAppleSnapshotPath(
      { segments: denseRoute, width: 640, height: 480, scale: 2 },
      credentials
    )

    expect(path).not.toBeNull()
    const signedUrl = signAppleSnapshotPath(path as string, privateKeyPem)
    expect(signedUrl.length).toBeLessThanOrEqual(URL_BUDGET)

    const overlays = JSON.parse(
      queryParams(path as string).get('overlays') as string
    ) as PolylineOverlay[]
    expect(overlays.length).toBeGreaterThan(0)
    expect(overlays.every((overlay) => overlay.type === 'polyline')).toBe(true)
  })

  it('draws the whole route when the finest fidelity overflows the url budget', () => {
    const path = buildAppleSnapshotPath(
      { segments: longRide, width: 640, height: 480, scale: 2 },
      credentials
    )

    expect(path).not.toBeNull()
    expect(
      signAppleSnapshotPath(path as string, privateKeyPem).length
    ).toBeLessThanOrEqual(URL_BUDGET)

    const drawn = overlaysOf(path as string).flatMap((overlay) =>
      decodePolyline(overlay.points)
    )
    const input = longRide[0].points

    // Endpoints survive Douglas-Peucker, so the drawn line must start at the
    // first vertex and end at the last one — the greedy pack-until-full builder
    // dropped the tail chunks and ended a quarter of the way in.
    expect(drawn[0].lat).toBeCloseTo(input[0].lat, 4)
    expect(drawn[0].lng).toBeCloseTo(input[0].lng, 4)
    expect(drawn[drawn.length - 1].lat).toBeCloseTo(
      input[input.length - 1].lat,
      4
    )
    expect(drawn[drawn.length - 1].lng).toBeCloseTo(
      input[input.length - 1].lng,
      4
    )

    // `center=auto` frames the overlays, so they must span the full extent.
    const drawnBounds = boundsOf(drawn)
    const inputBounds = boundsOf(input)
    expect(drawnBounds.minLat).toBeCloseTo(inputBounds.minLat, 2)
    expect(drawnBounds.maxLat).toBeCloseTo(inputBounds.maxLat, 2)
    expect(drawnBounds.minLng).toBeCloseTo(inputBounds.minLng, 2)
    expect(drawnBounds.maxLng).toBeCloseTo(inputBounds.maxLng, 2)
  })

  it('keeps every segment of a multi segment route', () => {
    const segments = Array.from({ length: 5 }, (_, segmentIndex) =>
      route(
        Array.from({ length: 1200 }, (_, index) => ({
          lat:
            52 + segmentIndex * 0.5 + index * 0.0005 + (index % 2 ? 0.0004 : 0),
          lng:
            5 + segmentIndex * 0.5 + index * 0.0004 + (index % 3 ? 0.0003 : 0)
        }))
      )
    )

    const path = buildAppleSnapshotPath(
      { segments, width: 640, height: 480, scale: 2 },
      credentials
    )

    expect(path).not.toBeNull()
    const overlays = overlaysOf(path as string)
    const drawn = overlays.map((overlay) => decodePolyline(overlay.points))

    // Each segment is far away from the others, so every one of them must still
    // contribute at least one overlay near its own last vertex.
    for (const segment of segments) {
      const last = segment.points[segment.points.length - 1]
      expect(
        drawn.some((points) =>
          points.some(
            (point) =>
              Math.abs(point.lat - last.lat) < 0.01 &&
              Math.abs(point.lng - last.lng) < 0.01
          )
        )
      ).toBe(true)
    }
  })
})

describe('signAppleSnapshotPath', () => {
  it('appends the signature as the final query parameter of the snapshot URL', () => {
    const path = buildAppleSnapshotPath(
      { segments: straightRoute, width: 640, height: 480, scale: 2 },
      credentials
    )
    const signedUrl = signAppleSnapshotPath(path as string, privateKeyPem)

    expect(signedUrl.startsWith(`${SNAPSHOT_HOST}${path}`)).toBe(true)
    const signature = signedUrl.slice(signedUrl.indexOf('&signature=') + 11)
    expect(signature).not.toContain('&')
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('signs the exact path and query preceding the signature parameter', () => {
    const path = buildAppleSnapshotPath(
      { segments: straightRoute, width: 640, height: 480, scale: 2 },
      credentials
    ) as string
    const signedUrl = signAppleSnapshotPath(path, privateKeyPem)
    const signature = Buffer.from(
      signedUrl.slice(signedUrl.indexOf('&signature=') + 11),
      'base64url'
    )

    expect(
      crypto.verify(
        'sha256',
        Buffer.from(path),
        { key: keyPair.publicKey, dsaEncoding: 'ieee-p1363' },
        signature
      )
    ).toBe(true)
  })

  it('accepts an escaped single-line private key', () => {
    const path = buildAppleSnapshotPath(
      { segments: straightRoute, width: 640, height: 480 },
      credentials
    ) as string
    const escapedKey = privateKeyPem.replace(/\n/g, '\\n')

    // ECDSA signatures are randomised, so verify rather than compare bytes.
    const signedUrl = signAppleSnapshotPath(path, escapedKey)
    const signature = Buffer.from(
      signedUrl.slice(signedUrl.indexOf('&signature=') + 11),
      'base64url'
    )

    expect(
      crypto.verify(
        'sha256',
        Buffer.from(path),
        { key: keyPair.publicKey, dsaEncoding: 'ieee-p1363' },
        signature
      )
    ).toBe(true)
  })

  it('signs with the memoized key on repeat calls and re-imports a changed key', () => {
    const path = buildAppleSnapshotPath(
      { segments: straightRoute, width: 640, height: 480 },
      credentials
    ) as string
    const otherKeyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1'
    })
    const otherPrivateKeyPem = otherKeyPair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString()

    const signatureOf = (privateKey: string) => {
      const signedUrl = signAppleSnapshotPath(path, privateKey)
      return Buffer.from(
        signedUrl.slice(signedUrl.indexOf('&signature=') + 11),
        'base64url'
      )
    }

    const verify = (signature: Buffer, publicKey: crypto.KeyObject) =>
      crypto.verify(
        'sha256',
        Buffer.from(path),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signature
      )

    const first = signatureOf(privateKeyPem)
    const cached = signatureOf(privateKeyPem)
    const other = signatureOf(otherPrivateKeyPem)

    expect(verify(first, keyPair.publicKey)).toBe(true)
    expect(verify(cached, keyPair.publicKey)).toBe(true)
    // A different key is re-imported rather than served from the memo.
    expect(verify(other, otherKeyPair.publicKey)).toBe(true)
    expect(verify(other, keyPair.publicKey)).toBe(false)
  })
})

describe('fetchAppleSnapshot', () => {
  const fullCredentials = { ...credentials, privateKey: privateKeyPem }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the image bytes from the signed snapshot URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' }
      })
    )

    const result = await fetchAppleSnapshot(
      { segments: straightRoute, width: 640, height: 480, scale: 2 },
      fullCredentials
    )

    expect(result).toEqual(Buffer.from([1, 2, 3]))
    const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
    expect(requestedUrl.startsWith(`${SNAPSHOT_HOST}/api/v1/snapshot?`)).toBe(
      true
    )
    expect(requestedUrl).toContain('&signature=')
  })

  it('returns null without fetching when there is no usable geometry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await fetchAppleSnapshot(
      { segments: [], width: 640, height: 480 },
      fullCredentials
    )

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'the upstream responds with an error status',
      response: () => new Response('nope', { status: 413 })
    },
    {
      description: 'the upstream content type is not an image',
      response: () =>
        new Response('<html></html>', {
          headers: { 'content-type': 'text/html' }
        })
    }
  ])('returns null when $description', async ({ response }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())

    const result = await fetchAppleSnapshot(
      { segments: straightRoute, width: 640, height: 480 },
      fullCredentials
    )

    expect(result).toBeNull()
  })

  it('returns null when the request throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    const result = await fetchAppleSnapshot(
      { segments: straightRoute, width: 640, height: 480 },
      fullCredentials
    )

    expect(result).toBeNull()
  })
})
