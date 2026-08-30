import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getInstancePeers: vi.fn()
}

let databasePresent: typeof mockDatabase | null = mockDatabase

vi.mock('@/lib/database', () => ({
  getDatabase: () => databasePresent
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    trustedHosts: ['alias.llun.test']
  })
}))

const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance/peers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    databasePresent = mockDatabase
    mockDatabase.getInstancePeers.mockResolvedValue([
      'remote1.test',
      'remote2.test'
    ])
  })

  it('returns peers excluding the canonical host by default', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/peers'),
      params
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getInstancePeers).toHaveBeenCalledWith({
      localDomain: 'llun.test'
    })
    const data = await response.json()
    expect(data).toEqual(['remote1.test', 'remote2.test'])
  })

  it('returns peers excluding a trusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/peers', {
        headers: { 'x-forwarded-host': 'alias.llun.test' }
      }),
      params
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getInstancePeers).toHaveBeenCalledWith({
      localDomain: 'alias.llun.test'
    })
  })

  it('returns 500 when database is not available', async () => {
    databasePresent = null
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/peers'),
      params
    )

    expect(response.status).toBe(500)
  })
})
