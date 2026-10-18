import { NextRequest } from 'next/server'

import { GET } from './route'

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test', trustedHosts: ['alias.llun.test'] }),
  getBaseURL: () => 'https://llun.test',
  buildBaseURL: (host: string) => `https://${host}`
}))

const params = { params: Promise.resolve({}) }

const getLinks = async (headers: Record<string, string>) => {
  const response = await GET(
    new NextRequest('https://llun.test/.well-known/nodeinfo', { headers }),
    params
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { links: { href: string }[] }
  return body.links.map((link) => link.href)
}

describe('GET /.well-known/nodeinfo', () => {
  it('links to the schema documents on the trusted host the request used', async () => {
    await expect(
      getLinks({ 'x-forwarded-host': 'alias.llun.test' })
    ).resolves.toEqual([
      'https://alias.llun.test/nodeinfo/2.0',
      'https://alias.llun.test/nodeinfo/2.1'
    ])
  })

  it('falls back to the primary host for an untrusted request host', async () => {
    await expect(
      getLinks({ 'x-forwarded-host': 'evil.example' })
    ).resolves.toEqual([
      'https://llun.test/nodeinfo/2.0',
      'https://llun.test/nodeinfo/2.1'
    ])
  })
})
