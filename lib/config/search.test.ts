describe('search config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_SEARCH_BACKEND
    delete process.env.ACTIVITIES_SEARCH_MEILISEARCH_URL
    delete process.env.ACTIVITIES_SEARCH_MEILISEARCH_API_KEY
    delete process.env.ACTIVITIES_SEARCH_MEILISEARCH_INDEX_PREFIX
    delete process.env.ACTIVITIES_SEARCH_MEILISEARCH_TIMEOUT_MS
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('defaults to database search', async () => {
    const { getSearchConfig } = await import('./search')

    expect(getSearchConfig()).toEqual({
      search: { backend: 'database' }
    })
  })

  it('reads Meilisearch settings from runtime environment variables', async () => {
    process.env.ACTIVITIES_SEARCH_BACKEND = 'meilisearch'
    process.env.ACTIVITIES_SEARCH_MEILISEARCH_URL = 'https://search.test'
    process.env.ACTIVITIES_SEARCH_MEILISEARCH_API_KEY = 'secret'
    process.env.ACTIVITIES_SEARCH_MEILISEARCH_INDEX_PREFIX = 'custom_prefix'
    process.env.ACTIVITIES_SEARCH_MEILISEARCH_TIMEOUT_MS = '1500'

    const { getSearchConfig } = await import('./search')

    expect(getSearchConfig()).toEqual({
      search: {
        backend: 'meilisearch',
        url: 'https://search.test',
        apiKey: 'secret',
        indexPrefix: 'custom_prefix',
        timeoutMs: 1500
      }
    })
  })
})
