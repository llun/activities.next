import { searchMeilisearch } from './meilisearch'

describe('Meilisearch search backend', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
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
        config: {
          backend: 'meilisearch',
          url: 'https://search.test',
          apiKey: 'secret',
          indexPrefix: 'activities_next',
          timeoutMs: 2000
        },
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
})
