describe('next config search environment isolation', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = {
      ...originalEnv,
      ACTIVITIES_SEARCH_BACKEND: 'meilisearch',
      ACTIVITIES_SEARCH_MEILISEARCH_URL: 'not-a-url',
      ACTIVITIES_SEARCH_MEILISEARCH_TIMEOUT_MS: 'not-a-number'
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('does not consume search runtime config during module import', async () => {
    await expect(import('@/next.config')).resolves.toMatchObject({
      default: expect.objectContaining({
        reactStrictMode: true
      })
    })
  })
})
