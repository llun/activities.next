import { NextRequest } from 'next/server'

import { GET } from './route'

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test', trustedHosts: ['alias.llun.test'] }),
  getBaseURL: () => 'https://llun.test',
  buildBaseURL: (host: string) => `https://${host}`
}))

const params = { params: Promise.resolve({}) }

const getTemplate = async (headers: Record<string, string>) => {
  const response = await GET(
    new NextRequest('https://llun.test/.well-known/host-meta', { headers }),
    params
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe(
    'application/xrd+xml; charset=utf-8'
  )
  return (await response.text()).match(/template="([^"]+)"/)?.[1]
}

describe('GET /.well-known/host-meta', () => {
  it('points WebFinger at the trusted host the request used', async () => {
    await expect(
      getTemplate({ 'x-forwarded-host': 'alias.llun.test' })
    ).resolves.toBe(
      'https://alias.llun.test/.well-known/webfinger?resource={uri}'
    )
  })

  it('falls back to the primary host for an untrusted request host', async () => {
    await expect(
      getTemplate({ 'x-forwarded-host': 'evil.example' })
    ).resolves.toBe('https://llun.test/.well-known/webfinger?resource={uri}')
  })
})
