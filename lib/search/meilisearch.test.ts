import {
  configureMeilisearchIndex,
  resetMeilisearchIndexConfigurationCacheForTests,
  searchMeilisearch,
  writeMeilisearchDocuments
} from './meilisearch'

describe('Meilisearch search backend', () => {
  const originalFetch = global.fetch
  const config = (indexPrefix: string) => ({
    backend: 'meilisearch' as const,
    url: 'https://search.test',
    apiKey: 'secret',
    indexPrefix,
    timeoutMs: 2000
  })
  const fetchResponse = (status: number, data: unknown = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  })

  afterEach(() => {
    global.fetch = originalFetch
    resetMeilisearchIndexConfigurationCacheForTests()
    jest.restoreAllMocks()
  })

  it('queries the configured index and returns entity ids', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [{ entityId: 'actor-1' }, { entityId: 'actor-2' }]
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      searchMeilisearch({
        config: config('activities_next'),
        type: 'accounts',
        query: 'alice',
        limit: 2,
        offset: 1
      })
    ).resolves.toEqual(['actor-1', 'actor-2'])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://search.test/indexes/activities_next_accounts/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          q: 'alice',
          limit: 2,
          offset: 1,
          attributesToRetrieve: ['entityId']
        }),
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('creates indexes with the Meilisearch create-index API and updates settings', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fetchResponse(202))
      .mockResolvedValueOnce(fetchResponse(202))
    global.fetch = fetchMock as unknown as typeof fetch

    await configureMeilisearchIndex({
      config: config('create_index'),
      type: 'accounts'
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://search.test/indexes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          uid: 'create_index_accounts',
          primaryKey: 'id'
        }),
        signal: expect.any(AbortSignal)
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://search.test/indexes/create_index_accounts/settings',
      expect.objectContaining({
        method: 'PATCH'
      })
    )
  })

  it('updates settings when the index already exists', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fetchResponse(409))
      .mockResolvedValueOnce(fetchResponse(202))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      configureMeilisearchIndex({
        config: config('existing_index'),
        type: 'accounts'
      })
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects non-conflict index creation errors', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fetchResponse(400))
      .mockResolvedValueOnce(fetchResponse(202))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      configureMeilisearchIndex({
        config: config('invalid_create'),
        type: 'accounts'
      })
    ).rejects.toThrow('Meilisearch index configuration failed with status 400')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('configures each index once before writing document batches', async () => {
    const fetchMock = jest.fn().mockResolvedValue(fetchResponse(202))
    global.fetch = fetchMock as unknown as typeof fetch
    const searchConfig = config('cached_write')

    await writeMeilisearchDocuments({
      config: searchConfig,
      type: 'accounts',
      documents: [
        {
          id: 'doc-1',
          entityId: 'actor-1',
          text: 'Alice',
          entityType: 'accounts'
        }
      ]
    })
    await writeMeilisearchDocuments({
      config: searchConfig,
      type: 'accounts',
      documents: [
        {
          id: 'doc-2',
          entityId: 'actor-2',
          text: 'Alicia',
          entityType: 'accounts'
        }
      ]
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://search.test/indexes',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://search.test/indexes/cached_write_accounts/settings',
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://search.test/indexes/cached_write_accounts/documents',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://search.test/indexes/cached_write_accounts/documents',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
