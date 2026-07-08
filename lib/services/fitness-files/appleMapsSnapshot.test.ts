import crypto from 'node:crypto'

import { encodePolyline } from '@/lib/utils/polyline'

import {
  buildAppleSnapshotPath,
  fetchAppleSnapshot,
  signAppleSnapshotPath
} from './appleMapsSnapshot'

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

const queryParams = (path: string) =>
  new URLSearchParams(path.slice(path.indexOf('?') + 1))

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
