import { NextRequest } from 'next/server'

import { GET } from './route'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    trustedHosts: ['alias.llun.test'],
    serviceName: undefined,
    serviceDescription: undefined,
    languages: ['en'],
    mediaStorage: undefined
  })
}))

const params = { params: Promise.resolve({}) }

describe('GET /api/v2/instance', () => {
  it('serves the instance payload for an unauthenticated request', async () => {
    // No OAuthGuard mock: the route must work without any Authorization header,
    // matching Mastodon's public v2 instance endpoint. If a guard is ever
    // re-added, this tokenless request would fail.
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      domain: 'llun.test'
    })
  })

  it('reports the configured host by default', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      domain: 'llun.test'
    })
  })

  it('reports a trusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance', {
        headers: { 'x-forwarded-host': 'alias.llun.test' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      domain: 'alias.llun.test'
    })
  })

  it('ignores an untrusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance', {
        headers: { 'x-forwarded-host': 'evil.example' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      domain: 'llun.test'
    })
  })
})
