import {
  configureMeilisearchIndex,
  deleteMeilisearchDocument,
  deleteMeilisearchDocuments,
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
  const taskResponse = (taskUid: number) =>
    fetchResponse(202, {
      taskUid,
      status: 'enqueued'
    })
  const completedTaskResponse = (uid: number) =>
    fetchResponse(200, {
      uid,
      status: 'succeeded'
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
      .mockResolvedValueOnce(taskResponse(1))
      .mockResolvedValueOnce(completedTaskResponse(1))
      .mockResolvedValueOnce(taskResponse(2))
      .mockResolvedValueOnce(completedTaskResponse(2))
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
      'https://search.test/tasks/1',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://search.test/indexes/create_index_accounts/settings',
      expect.objectContaining({
        method: 'PATCH'
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://search.test/tasks/2',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('updates settings when the index already exists', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fetchResponse(409))
      .mockResolvedValueOnce(taskResponse(1))
      .mockResolvedValueOnce(completedTaskResponse(1))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      configureMeilisearchIndex({
        config: config('existing_index'),
        type: 'accounts'
      })
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects non-conflict index creation errors', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fetchResponse(400))
      .mockResolvedValueOnce(taskResponse(1))
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
    let taskUid = 0
    const fetchMock = jest.fn().mockImplementation(async (input: string) => {
      const taskMatch = input.match(/\/tasks\/(\d+)$/)
      if (taskMatch) {
        return completedTaskResponse(Number(taskMatch[1]))
      }
      taskUid += 1
      return taskResponse(taskUid)
    })
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

    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://search.test/indexes',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://search.test/indexes/cached_write_accounts/settings',
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://search.test/indexes/cached_write_accounts/documents',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      'https://search.test/indexes/cached_write_accounts/documents',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('rejects failed document write tasks', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fetchResponse(409))
      .mockResolvedValueOnce(taskResponse(1))
      .mockResolvedValueOnce(completedTaskResponse(1))
      .mockResolvedValueOnce(taskResponse(2))
      .mockResolvedValueOnce(
        fetchResponse(200, {
          uid: 2,
          status: 'failed',
          error: {
            message: 'bad documents',
            code: 'invalid_document'
          }
        })
      )
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      writeMeilisearchDocuments({
        config: config('failed_write'),
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
    ).rejects.toThrow(
      'Meilisearch document write task 2 failed: bad documents invalid_document'
    )
  })

  it('rejects async responses without a task uid', async () => {
    const fetchMock = jest.fn().mockResolvedValue(fetchResponse(202, {}))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      configureMeilisearchIndex({
        config: config('missing_task'),
        type: 'accounts'
      })
    ).rejects.toThrow(
      'Meilisearch index configuration did not return a taskUid'
    )
  })

  it('waits for delete tasks and preserves missing-index success', async () => {
    const deleteFetchMock = jest
      .fn()
      .mockResolvedValueOnce(taskResponse(1))
      .mockResolvedValueOnce(completedTaskResponse(1))
      .mockResolvedValueOnce(fetchResponse(404))
    global.fetch = deleteFetchMock as unknown as typeof fetch

    await deleteMeilisearchDocuments({
      config: config('delete_index'),
      type: 'accounts'
    })
    await deleteMeilisearchDocuments({
      config: config('delete_index'),
      type: 'accounts'
    })

    expect(deleteFetchMock).toHaveBeenCalledTimes(3)
  })

  it('deletes individual documents by id', async () => {
    const deleteFetchMock = jest
      .fn()
      .mockResolvedValueOnce(taskResponse(1))
      .mockResolvedValueOnce(completedTaskResponse(1))
    global.fetch = deleteFetchMock as unknown as typeof fetch

    await deleteMeilisearchDocument({
      config: config('delete_document'),
      type: 'statuses',
      documentId: 'doc/with/slashes'
    })

    expect(deleteFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://search.test/indexes/delete_document_statuses/documents/doc%2Fwith%2Fslashes',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
