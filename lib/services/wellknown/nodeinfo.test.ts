import { getDatabase } from '@/lib/database'

import { buildNodeInfo20 } from './nodeinfo'

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

const mockedGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>

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
})
