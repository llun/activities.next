import { NextRequest } from 'next/server'

import { getDomainCheckProof } from '@/lib/services/domains/domainCheck'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'

import { GET } from './route'

const NONCE = 'abcdefghijklmnop1234'

const request = (nonce: string | null, headers: Record<string, string>) =>
  new NextRequest(
    `https://photos.example/api/well-known/activities-domain-check${
      nonce === null ? '' : `?nonce=${nonce}`
    }`,
    { headers }
  )

describe('GET /.well-known/activities-domain-check', () => {
  it('signs the nonce with the host the request arrived on', async () => {
    const response = await GET(request(NONCE, { host: 'photos.example' }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({
      proof: getDomainCheckProof(NONCE, 'photos.example', MOCK_SECRET_PHASES)
    })
  })

  it('signs the forwarded host, so a proxy that rewrites Host is caught', async () => {
    const response = await GET(
      request(NONCE, {
        host: 'internal:3000',
        'x-forwarded-host': 'social.example'
      }),
      { params: Promise.resolve({}) }
    )
    const body = await response.json()
    expect(body.proof).toBe(
      getDomainCheckProof(NONCE, 'social.example', MOCK_SECRET_PHASES)
    )
  })

  it.each([null, 'short', 'bad nonce with spaces'])(
    'refuses a missing or malformed nonce (%s)',
    async (nonce) => {
      const response = await GET(request(nonce, { host: 'photos.example' }), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(400)
    }
  )
})
