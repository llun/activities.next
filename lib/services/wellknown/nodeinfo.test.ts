import { getDatabase } from '@/lib/database'

import { NODE_INFO_20_CONTENT_TYPE, buildNodeInfo20 } from './nodeinfo'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'test.example.com',
    serviceName: 'Test Service',
    serviceDescription: 'Test description'
  }),
  getBaseURL: jest.fn().mockReturnValue('https://test.example.com')
}))

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn()
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

const mockedGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>

describe('NODE_INFO_20_CONTENT_TYPE', () => {
  it('carries the NodeInfo 2.0 schema profile', () => {
    expect(NODE_INFO_20_CONTENT_TYPE).toBe(
      'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.0#"'
    )
  })
})

describe('#buildNodeInfo20', () => {
  afterEach(() => {
    mockedGetDatabase.mockReset()
  })

  it('returns null when the database is unavailable', async () => {
    mockedGetDatabase.mockReturnValue(null)

    expect(await buildNodeInfo20()).toBeNull()
  })

  it('builds the document from database stats', async () => {
    const getNodeInfoStats = jest.fn().mockResolvedValue({
      totalUsers: 7,
      activeMonth: 2,
      activeHalfyear: 5,
      localPosts: 99
    })
    mockedGetDatabase.mockReturnValue({
      getNodeInfoStats
    } as unknown as ReturnType<typeof getDatabase>)

    const nodeInfo = await buildNodeInfo20()

    expect(getNodeInfoStats).toHaveBeenCalledTimes(1)
    expect(nodeInfo).toMatchObject({
      version: '2.0',
      usage: {
        users: { total: 7, activeMonth: 2, activeHalfyear: 5 },
        localPosts: 99,
        localComments: 0
      },
      metadata: {
        nodeName: 'Test Service',
        nodeDescription: 'Test description'
      }
    })
  })

  it('returns null when the stats query throws', async () => {
    mockedGetDatabase.mockReturnValue({
      getNodeInfoStats: jest.fn().mockRejectedValue(new Error('db down'))
    } as unknown as ReturnType<typeof getDatabase>)

    expect(await buildNodeInfo20()).toBeNull()
  })
})
