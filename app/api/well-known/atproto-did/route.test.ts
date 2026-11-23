import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'

import { GET } from './route'

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/services/guards/headerHost', () => ({ headerHost: vi.fn() }))

const getBlueskyAccountByInstanceHandle = vi.fn()
const database = { getBlueskyAccountByInstanceHandle }

const request = () =>
  new NextRequest('https://social.example/.well-known/atproto-did')

const call = () => GET(request(), { params: Promise.resolve({}) })

describe('GET /.well-known/atproto-did', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getDatabase).mockReturnValue(database as never)
    vi.mocked(headerHost).mockReturnValue('social.example')
  })

  it('answers the DID for a host an admin claimed', async () => {
    getBlueskyAccountByInstanceHandle.mockResolvedValue({
      did: 'did:plc:abc123'
    })
    const response = await call()
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

  it('answers 404 for a host nobody claimed', async () => {
    getBlueskyAccountByInstanceHandle.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })
})
