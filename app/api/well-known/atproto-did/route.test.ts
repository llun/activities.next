import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'

import { GET } from './route'

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))

const getBlueskyAccountByInstanceHandle = vi.fn()
const database = { getBlueskyAccountByInstanceHandle }

const call = (host: string) =>
  GET(
    new NextRequest(`https://${host}/.well-known/atproto-did`, {
      headers: { host }
    }),
    { params: Promise.resolve({}) }
  )

describe('GET /.well-known/atproto-did', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getDatabase).mockReturnValue(database as never)
  })

  it('answers the DID for the domain the request arrived on', async () => {
    getBlueskyAccountByInstanceHandle.mockResolvedValue({
      did: 'did:plc:abc123'
    })
    const response = await call('Social.Example')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('did:plc:abc123')
    expect(getBlueskyAccountByInstanceHandle).toHaveBeenCalledWith({
      host: 'social.example'
    })
  })

  it('looks up the raw authority, never a fallback to the primary host', async () => {
    getBlueskyAccountByInstanceHandle.mockResolvedValue(null)
    const response = await call('203.0.113.5')
    expect(getBlueskyAccountByInstanceHandle).toHaveBeenCalledWith({
      host: '203.0.113.5'
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })
})
