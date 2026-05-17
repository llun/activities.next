import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

import { search } from './index'
import { searchMeilisearch } from './meilisearch'
import { resolveAccountForSearch } from './resolveAccount'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn()
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: jest.fn()
  }
}))

jest.mock('./meilisearch', () => ({
  searchMeilisearch: jest.fn()
}))

jest.mock('./resolveAccount', () => ({
  resolveAccountForSearch: jest.fn()
}))

describe('search service', () => {
  const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
  const mockSearchMeilisearch = searchMeilisearch as jest.MockedFunction<
    typeof searchMeilisearch
  >
  const mockLoggerWarn = logger.warn as jest.Mock
  const mockResolveAccountForSearch =
    resolveAccountForSearch as jest.MockedFunction<
      typeof resolveAccountForSearch
    >

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetConfig.mockReturnValue({
      search: {
        backend: 'meilisearch',
        url: 'https://search.test',
        indexPrefix: 'activities_next',
        timeoutMs: 2000
      }
    } as ReturnType<typeof getConfig>)
  })

  it('falls back to database search when Meilisearch fails', async () => {
    const database = {
      searchAccounts: jest.fn().mockResolvedValue([{ id: 'account-1' }]),
      searchStatuses: jest.fn(),
      searchHashtags: jest.fn()
    } as unknown as Database
    mockSearchMeilisearch.mockRejectedValue(new Error('search unavailable'))

    await expect(
      search({
        database,
        query: 'alice',
        limit: 10,
        offset: 0,
        includeAccounts: true,
        includeStatuses: false,
        includeHashtags: false
      })
    ).resolves.toEqual({
      accounts: [{ id: 'account-1' }],
      statuses: [],
      hashtags: []
    })

    expect(database.searchAccounts).toHaveBeenCalledWith({
      query: 'alice',
      limit: 10,
      offset: 0,
      currentActorId: undefined,
      following: undefined,
      resolve: undefined
    })
    expect(mockLoggerWarn).toHaveBeenCalledWith({
      message: 'Meilisearch search failed; falling back to database search',
      error: 'search unavailable'
    })
  })

  it('uses database search after resolving a remote account', async () => {
    const database = {
      searchAccounts: jest.fn().mockResolvedValue([{ id: 'account-1' }]),
      searchStatuses: jest.fn(),
      searchHashtags: jest.fn()
    } as unknown as Database

    await expect(
      search({
        database,
        query: 'alice@example.com',
        limit: 10,
        offset: 0,
        includeAccounts: true,
        includeStatuses: false,
        includeHashtags: false,
        resolve: true
      })
    ).resolves.toEqual({
      accounts: [{ id: 'account-1' }],
      statuses: [],
      hashtags: []
    })

    expect(mockResolveAccountForSearch).toHaveBeenCalledWith({
      database,
      query: 'alice@example.com'
    })
    expect(mockSearchMeilisearch).not.toHaveBeenCalled()
    expect(database.searchAccounts).toHaveBeenCalledWith({
      query: 'alice@example.com',
      limit: 10,
      offset: 0,
      currentActorId: undefined,
      following: undefined,
      resolve: true
    })
  })
})
