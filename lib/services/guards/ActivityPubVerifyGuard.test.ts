import { NextRequest } from 'next/server'

import { HttpMethod } from '@/lib/utils/getCORSHeaders'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'

const mockDatabase = {}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('ActivityPubVerifySenderGuard', () => {
  it('returns CORS headers on verification errors when methods are provided', async () => {
    const handler = jest.fn()
    const guard = ActivityPubVerifySenderGuard(handler, [
      HttpMethod.enum.OPTIONS,
      HttpMethod.enum.POST
    ])

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          host: 'activities.local',
          origin: 'https://remote.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://remote.test'
    )
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'OPTIONS,POST'
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects stale signed dates', async () => {
    const handler = jest.fn()
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: 'Wed, 09 Nov 2022 18:28:37 GMT',
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="signature"'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects mismatched signed digest headers', async () => {
    const handler = jest.fn()
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: new Date().toUTCString(),
          digest: 'SHA-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
        },
        body: JSON.stringify({ type: 'Follow' })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })
})
