import { NextRequest } from 'next/server'

import { GET } from './route'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    trustedHosts: ['alias.llun.test'],
    serviceName: undefined,
    serviceDescription: undefined,
    languages: ['en'],
    mediaStorage: undefined
  })
}))

const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance', () => {
  it('reports the configured host by default', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance'),
      params
    )
    await expect(response.json()).resolves.toMatchObject({ uri: 'llun.test' })
  })

  it('reports a trusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance', {
        headers: { 'x-forwarded-host': 'alias.llun.test' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      uri: 'alias.llun.test'
    })
  })

  it('ignores an untrusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance', {
        headers: { 'x-forwarded-host': 'evil.example' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({ uri: 'llun.test' })
  })
})
