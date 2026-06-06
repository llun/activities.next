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

// v2 is behind OAuthGuard; pass the request straight through to the handler.
jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (_scopes: unknown, handle: (req: unknown, context: unknown) => unknown) =>
    (req: unknown, context: unknown) =>
      handle(req, context)
}))

const params = { params: Promise.resolve({}) }

describe('GET /api/v2/instance', () => {
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
