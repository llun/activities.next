import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { logger } from '@/lib/utils/logger'

import {
  NODE_INFO_20_CONTENT_TYPE,
  buildNodeInfo20,
  getNodeInfo20
} from './nodeinfo'

const DEFAULT_CONFIG = {
  host: 'test.example.com',
  serviceName: 'Test Service',
  serviceDescription: 'Test description'
}

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn().mockReturnValue('https://test.example.com')
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockedGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetConfig.mockReturnValue(
    DEFAULT_CONFIG as unknown as ReturnType<typeof getConfig>
  )
})

const STATS = {
  totalUsers: 7,
  activeMonth: 2,
  activeHalfyear: 5,
  localPosts: 99
}

describe('NODE_INFO_20_CONTENT_TYPE', () => {
  it('carries the NodeInfo 2.0 schema profile', () => {
    expect(NODE_INFO_20_CONTENT_TYPE).toBe(
      'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.0#"'
    )
  })
})

describe('getNodeInfo20', () => {
  it('falls back to host when serviceName is a blank string', () => {
    mockedGetConfig.mockReturnValue({
      ...DEFAULT_CONFIG,
      serviceName: ''
    } as unknown as ReturnType<typeof getConfig>)

    expect(getNodeInfo20(STATS).metadata.nodeName).toBe('test.example.com')
  })

  it('uses serviceName when it is set', () => {
    expect(getNodeInfo20(STATS).metadata.nodeName).toBe('Test Service')
  })
})

describe('buildNodeInfo20', () => {
  it('returns null and logs when the database is unavailable', async () => {
    mockedGetDatabase.mockReturnValue(null)

    expect(await buildNodeInfo20()).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      'NodeInfo 2.0 requested but the database is unavailable'
    )
  })

  it('builds the document from database stats', async () => {
    const getNodeInfoStats = vi.fn().mockResolvedValue(STATS)
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
      getNodeInfoStats: vi.fn().mockRejectedValue(new Error('db down'))
    } as unknown as ReturnType<typeof getDatabase>)

    expect(await buildNodeInfo20()).toBeNull()
  })
})
