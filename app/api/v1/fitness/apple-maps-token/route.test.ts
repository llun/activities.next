import { decodeJwt, decodeProtectedHeader } from 'jose'
import { NextRequest } from 'next/server'
import { generateKeyPairSync } from 'node:crypto'

import type { MapProviderConfig } from '@/lib/config/mapProvider'

import { GET } from './route'

const TEAM_ID = 'TEAM123456'
const KEY_ID = 'KEY1234567'

const state = vi.hoisted(() => ({
  mapProvider: { type: 'osm' } as MapProviderConfig
}))

vi.mock('@/lib/config/mapProvider', () => ({
  getMapProviderConfig: () => state.mapProvider,
  getPublicMapProvider: () => ({ type: 'osm' })
}))

vi.mock('@/lib/config/host', () => ({
  getHostConfigFromEnvironment: () => ({
    host: 'maps.llun.test',
    trustedHosts: ['alias.llun.test'],
    allowActorDomains: []
  }),
  getProxyHostConfig: () => ({
    host: 'maps.llun.test',
    // A blank entry and a duplicate exercise the dedupe/skip-blank logic.
    trustedHosts: ['alias.llun.test', '', 'maps.llun.test']
  }),
  resetHostConfigCacheForTests: () => {}
}))

const params = { params: Promise.resolve({}) }

const createPrivateKeyPem = () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

describe('GET /api/v1/fitness/apple-maps-token', () => {
  beforeEach(() => {
    state.mapProvider = { type: 'osm' }
  })

  it('mints a MapKit JS token signed with the configured Apple credentials', async () => {
    state.mapProvider = {
      type: 'apple',
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: createPrivateKeyPem()
    }

    const response = await GET(
      new NextRequest('https://maps.llun.test/api/v1/fitness/apple-maps-token'),
      params
    )
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      token: string
      expiresAt: number
    }
    expect(typeof body.token).toBe('string')
    expect(typeof body.expiresAt).toBe('number')

    const header = decodeProtectedHeader(body.token)
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(KEY_ID)
    expect(header.typ).toBe('JWT')

    const payload = decodeJwt(body.token) as {
      iss?: string
      iat?: number
      exp?: number
      scope?: string
      origin?: string
    }
    expect(payload.iss).toBe(TEAM_ID)
    expect(payload.scope).toBe('mapkit_js')
    expect(payload.origin).toContain('https://maps.llun.test')
    expect(payload.exp).toBeDefined()
    expect(payload.iat).toBeDefined()
    expect((payload.exp as number) - (payload.iat as number)).toBeCloseTo(
      1800,
      -1
    )
  })

  it('bounds the token origin to the host and its trusted hosts, deduped', async () => {
    state.mapProvider = {
      type: 'apple',
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: createPrivateKeyPem()
    }

    const response = await GET(
      new NextRequest('https://maps.llun.test/api/v1/fitness/apple-maps-token'),
      params
    )
    const body = (await response.json()) as { token: string }
    const payload = decodeJwt(body.token) as { origin?: string }
    expect(payload.origin?.split(',')).toEqual([
      'https://maps.llun.test',
      'https://alias.llun.test'
    ])
  })

  it.each([
    { description: 'osm provider', provider: { type: 'osm' } },
    {
      description: 'mapbox provider',
      provider: { type: 'mapbox', accessToken: 'pk.token' }
    }
  ] satisfies { description: string; provider: MapProviderConfig }[])(
    'returns 404 for $description',
    async ({ provider }) => {
      state.mapProvider = provider

      const response = await GET(
        new NextRequest(
          'https://maps.llun.test/api/v1/fitness/apple-maps-token'
        ),
        params
      )
      expect(response.status).toBe(404)
    }
  )

  it('returns 500 when the configured private key cannot be imported', async () => {
    state.mapProvider = {
      type: 'apple',
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: 'not-a-pem-key'
    }

    const response = await GET(
      new NextRequest('https://maps.llun.test/api/v1/fitness/apple-maps-token'),
      params
    )
    expect(response.status).toBe(500)
  })
})
