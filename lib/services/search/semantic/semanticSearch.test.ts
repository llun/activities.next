import {
  notifyActorUnindexed,
  notifyStatusDocumentsWritten,
  setSemanticSearchListener
} from '@/lib/database/domains/search/semanticHooks'
import {
  claimPendingEmbeddings,
  clearEmbeddingPending,
  deleteEmbeddings,
  deleteEmbeddingsForActor,
  getActorStatusDocumentIds,
  getEmbeddableDocuments,
  getEmbeddingContentHash,
  getSemanticAvailability,
  getStoredEmbeddings,
  hasClaimablePendingEmbeddings,
  markEmbeddingsFailed,
  markEmbeddingsPending,
  recordSemanticFailure,
  recordSemanticSuccess,
  releaseEmbeddingClaims,
  storeEmbeddings
} from '@/lib/database/domains/search/semanticStore'
import type { Db } from '@/lib/database/kysely'
import { EMBED_SEARCH_DOCUMENTS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { parseSearchQuery } from '@/lib/services/search/parseSearchQuery'
import { getEmbeddingProvider } from '@/lib/services/search/semantic/index'
import {
  EMBEDDING_INLINE_JOB_MAX_PASSES,
  EMBEDDING_JOB_BATCH_SIZE,
  EMBEDDING_JOB_MAX_PASSES,
  QUERY_EMBEDDING_TIMEOUT_MS,
  clearQueryEmbeddingCache,
  createSemanticSearchListener,
  embedDocuments,
  embedSearchQuery,
  getDocumentsNeedingEmbedding,
  getSearchQueryEmbedding,
  resetActorOptInsForTests,
  resetEmbeddingJobScheduleForTests,
  runEmbeddingJob,
  scheduleEmbeddingJob
} from '@/lib/services/search/semantic/semanticSearch'
import {
  type EmbeddingProvider,
  EmbeddingProviderError
} from '@/lib/services/search/semantic/types'
import { logger } from '@/lib/utils/logger'

vi.mock(
  '@/lib/database/domains/search/semanticStore',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/database/domains/search/semanticStore')
      >()
    return {
      ...actual,
      claimPendingEmbeddings: vi.fn(),
      clearEmbeddingPending: vi.fn(),
      deleteEmbeddings: vi.fn(),
      deleteEmbeddingsForActor: vi.fn(),
      getActorStatusDocumentIds: vi.fn(),
      getEmbeddableDocuments: vi.fn(),
      getSemanticAvailability: vi.fn(),
      getStoredEmbeddings: vi.fn(),
      hasClaimablePendingEmbeddings: vi.fn(),
      markEmbeddingsFailed: vi.fn(),
      markEmbeddingsPending: vi.fn(),
      recordSemanticFailure: vi.fn(),
      recordSemanticSuccess: vi.fn(),
      releaseEmbeddingClaims: vi.fn(),
      storeEmbeddings: vi.fn()
    }
  }
)

vi.mock('@/lib/services/search/semantic/index', () => ({
  getEmbeddingProvider: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const mockDb = {} as Db
const TEN_MINUTES_MS = 10 * 60 * 1000

const createFakeProvider = (
  overrides: Partial<EmbeddingProvider> = {}
): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } => {
  const model = overrides.model ?? 'fake-model'
  const dimensions = overrides.dimensions ?? 4
  return {
    cacheKey: overrides.cacheKey ?? `fake:${model}:${dimensions}`,
    model,
    dimensions,
    maxBatchSize: overrides.maxBatchSize ?? 32,
    embed: vi.fn(async (texts: string[]) =>
      texts.map((_, index) => [index + 1, 0, 0, 0])
    ),
    ...overrides
  } as EmbeddingProvider & { embed: ReturnType<typeof vi.fn> }
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve()
  }
}

describe('semanticSearch service', () => {
  const publish = vi.fn()

  beforeEach(() => {
    clearQueryEmbeddingCache()
    resetActorOptInsForTests()
    resetEmbeddingJobScheduleForTests()
    setSemanticSearchListener(null)
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue)
      .mockReset()
      .mockReturnValue({
        publish,
        handle: vi.fn(),
        runsInline: false,
        dropsDelayedJobs: false
      } as unknown as ReturnType<typeof getQueue>)
    vi.mocked(getEmbeddingProvider).mockReset().mockReturnValue(null)
    vi.mocked(getSemanticAvailability)
      .mockReset()
      .mockResolvedValue({ available: true })
    vi.mocked(claimPendingEmbeddings).mockReset().mockResolvedValue([])
    vi.mocked(getActorStatusDocumentIds).mockReset().mockResolvedValue([])
    vi.mocked(getEmbeddableDocuments).mockReset().mockResolvedValue([])
    vi.mocked(getStoredEmbeddings).mockReset().mockResolvedValue(new Map())
    vi.mocked(hasClaimablePendingEmbeddings)
      .mockReset()
      .mockResolvedValue(false)
    vi.mocked(clearEmbeddingPending).mockReset().mockResolvedValue(undefined)
    vi.mocked(deleteEmbeddings).mockReset().mockResolvedValue(undefined)
    vi.mocked(deleteEmbeddingsForActor).mockReset().mockResolvedValue(undefined)
    vi.mocked(markEmbeddingsFailed).mockReset().mockResolvedValue(undefined)
    vi.mocked(markEmbeddingsPending).mockReset().mockResolvedValue(1)
    vi.mocked(recordSemanticFailure).mockReset().mockResolvedValue(undefined)
    vi.mocked(recordSemanticSuccess).mockReset().mockResolvedValue(undefined)
    vi.mocked(releaseEmbeddingClaims).mockReset().mockResolvedValue(undefined)
    vi.mocked(storeEmbeddings).mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    setSemanticSearchListener(null)
    vi.restoreAllMocks()
  })

  describe('embedSearchQuery', () => {
    it('caches query embeddings and passes query kind and 2s timeout', async () => {
      const provider = createFakeProvider()
      provider.embed.mockResolvedValue([[0.25, 0.5, 0.75, 1]])

      const t0 = 1_700_000_000_000
      const first = await embedSearchQuery(provider, 'coffee', t0)
      const second = await embedSearchQuery(provider, 'coffee', t0 + 1000)

      expect(first).toEqual([0.25, 0.5, 0.75, 1])
      expect(second).toEqual(first)
      expect(provider.embed).toHaveBeenCalledTimes(1)
      expect(provider.embed).toHaveBeenCalledWith(['coffee'], 'query', {
        timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS
      })
    })

    it('keys the cache by provider cacheKey (model and dimensions) and folded query', async () => {
      const providerA = createFakeProvider({
        cacheKey: 'openai:model-a:4',
        model: 'model-a',
        dimensions: 4
      })
      const providerDifferentModel = createFakeProvider({
        cacheKey: 'openai:model-b:4',
        model: 'model-b',
        dimensions: 4
      })
      const providerDifferentDims = createFakeProvider({
        cacheKey: 'openai:model-a:8',
        model: 'model-a',
        dimensions: 8
      })

      const t0 = 1_700_000_000_000
      await embedSearchQuery(providerA, 'Café', t0)
      // Accent-folded, case-folded, and trimmed query hits the same entry.
      await embedSearchQuery(providerA, '  cafe  ', t0 + 1)
      expect(providerA.embed).toHaveBeenCalledTimes(1)

      // Different model misses cache.
      await embedSearchQuery(providerDifferentModel, 'cafe', t0 + 2)
      expect(providerDifferentModel.embed).toHaveBeenCalledTimes(1)

      // Different dimensions misses cache.
      await embedSearchQuery(providerDifferentDims, 'cafe', t0 + 3)
      expect(providerDifferentDims.embed).toHaveBeenCalledTimes(1)
    })

    it('expires cached entries after 10 minutes', async () => {
      const provider = createFakeProvider()
      provider.embed
        .mockResolvedValueOnce([[1, 0, 0, 0]])
        .mockResolvedValueOnce([[0, 1, 0, 0]])

      const t0 = 1_700_000_000_000
      expect(await embedSearchQuery(provider, 'trail', t0)).toEqual([
        1, 0, 0, 0
      ])
      expect(
        await embedSearchQuery(provider, 'trail', t0 + TEN_MINUTES_MS - 1)
      ).toEqual([1, 0, 0, 0])
      expect(provider.embed).toHaveBeenCalledTimes(1)

      expect(
        await embedSearchQuery(provider, 'trail', t0 + TEN_MINUTES_MS)
      ).toEqual([0, 1, 0, 0])
      expect(provider.embed).toHaveBeenCalledTimes(2)
    })

    it('evicts the least recently used entry past 500 entries', async () => {
      const provider = createFakeProvider()
      const t0 = 1_700_000_000_000

      for (let i = 0; i < 500; i += 1) {
        await embedSearchQuery(provider, `query-${i}`, t0)
      }
      expect(provider.embed).toHaveBeenCalledTimes(500)

      // Touch query-0 so it moves to most-recently-used; query-1 is now oldest.
      await embedSearchQuery(provider, 'query-0', t0 + 1)
      expect(provider.embed).toHaveBeenCalledTimes(500)

      // Insert the 501st distinct query, evicting query-1.
      await embedSearchQuery(provider, 'query-500', t0 + 2)
      expect(provider.embed).toHaveBeenCalledTimes(501)

      // query-0 is still cached.
      await embedSearchQuery(provider, 'query-0', t0 + 3)
      expect(provider.embed).toHaveBeenCalledTimes(501)

      // query-1 was evicted and must re-embed.
      await embedSearchQuery(provider, 'query-1', t0 + 4)
      expect(provider.embed).toHaveBeenCalledTimes(502)
    })

    it('re-inserts an expired key at the most recently used end', async () => {
      const provider = createFakeProvider()
      const t0 = 1_700_000_000_000

      // query-0 expires at t0 + 10m; query-1..499 expire 5s later.
      await embedSearchQuery(provider, 'query-0', t0)
      for (let i = 1; i < 500; i += 1) {
        await embedSearchQuery(provider, `query-${i}`, t0 + 5_000)
      }
      expect(provider.embed).toHaveBeenCalledTimes(500)

      // At t1, query-0 is expired (and was oldest); re-embedding it must move
      // it to the most recently used end so query-1 is now oldest.
      const t1 = t0 + TEN_MINUTES_MS
      await embedSearchQuery(provider, 'query-0', t1)
      expect(provider.embed).toHaveBeenCalledTimes(501)

      // Inserting the 501st entry evicts query-1, not the freshly re-embedded query-0.
      await embedSearchQuery(provider, 'query-500', t1 + 1)
      expect(provider.embed).toHaveBeenCalledTimes(502)

      // query-0 is still cached.
      await embedSearchQuery(provider, 'query-0', t1 + 2)
      expect(provider.embed).toHaveBeenCalledTimes(502)

      // query-1 is not yet expired (t1 + 3 < t0 + 5s + 10m), so re-embedding
      // proves it was the entry evicted by LRU.
      await embedSearchQuery(provider, 'query-1', t1 + 3)
      expect(provider.embed).toHaveBeenCalledTimes(503)
    })

    it('does not cache a failed embedding', async () => {
      const provider = createFakeProvider()
      provider.embed
        .mockRejectedValueOnce(
          new EmbeddingProviderError('rate limited', {
            statusCode: 429,
            retryable: true
          })
        )
        .mockResolvedValueOnce([[0.5, 0.5, 0.5, 0.5]])

      const t0 = 1_700_000_000_000
      await expect(embedSearchQuery(provider, 'retry-me', t0)).rejects.toThrow(
        'rate limited'
      )

      await expect(
        embedSearchQuery(provider, 'retry-me', t0 + 1)
      ).resolves.toEqual([0.5, 0.5, 0.5, 0.5])
      expect(provider.embed).toHaveBeenCalledTimes(2)
    })
  })

  describe('getSearchQueryEmbedding', () => {
    it('returns null for latest sort without checking provider or rate limit', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const consumeRateLimit = vi.fn(() => true)

      const result = await getSearchQueryEmbedding({
        parsedQuery: parseSearchQuery('coffee'),
        sort: 'latest',
        consumeRateLimit,
        getDb: () => mockDb
      })

      expect(result).toBeNull()
      expect(consumeRateLimit).not.toHaveBeenCalled()
      expect(provider.embed).not.toHaveBeenCalled()
    })

    it.each([
      { description: 'operator-only query', q: 'from:me has:media' },
      { description: 'phrase-only query', q: '"exact phrase"' },
      { description: 'empty query', q: '   ' }
    ])(
      'returns null when there is no plain word ($description)',
      async ({ q }) => {
        const provider = createFakeProvider()
        vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
        const consumeRateLimit = vi.fn(() => true)

        const result = await getSearchQueryEmbedding({
          parsedQuery: parseSearchQuery(q),
          sort: 'relevance',
          consumeRateLimit,
          getDb: () => mockDb
        })

        expect(result).toBeNull()
        expect(consumeRateLimit).not.toHaveBeenCalled()
        expect(provider.embed).not.toHaveBeenCalled()
      }
    )

    it('returns null when no provider is configured', async () => {
      vi.mocked(getEmbeddingProvider).mockReturnValue(null)
      const consumeRateLimit = vi.fn(() => true)
      const getDb = vi.fn(() => mockDb)

      const result = await getSearchQueryEmbedding({
        parsedQuery: parseSearchQuery('coffee'),
        sort: 'relevance',
        consumeRateLimit,
        getDb
      })

      expect(result).toBeNull()
      expect(getDb).not.toHaveBeenCalled()
      expect(consumeRateLimit).not.toHaveBeenCalled()
    })

    it('returns null when the rate limit is spent', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const consumeRateLimit = vi.fn(() => false)

      const result = await getSearchQueryEmbedding({
        parsedQuery: parseSearchQuery('coffee'),
        sort: 'relevance',
        consumeRateLimit,
        getDb: () => mockDb
      })

      expect(result).toBeNull()
      expect(consumeRateLimit).toHaveBeenCalledTimes(1)
      expect(provider.embed).not.toHaveBeenCalled()
    })

    it('returns the embedding metadata when available and within rate limit', async () => {
      const provider = createFakeProvider({
        model: 'text-embedding-3-small',
        dimensions: 4
      })
      provider.embed.mockResolvedValue([[0.1, 0.2, 0.3, 0.4]])
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)

      const result = await getSearchQueryEmbedding({
        parsedQuery: parseSearchQuery('from:alice morning coffee'),
        sort: 'relevance',
        consumeRateLimit: () => true,
        getDb: () => mockDb
      })

      expect(result).toEqual({
        embedding: [0.1, 0.2, 0.3, 0.4],
        model: 'text-embedding-3-small',
        dimensions: 4
      })
      // Only the plain text (without operators) goes to the provider.
      expect(provider.embed).toHaveBeenCalledWith(['morning coffee'], 'query', {
        timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS
      })
    })

    it('returns null and records a health failure when the provider throws', async () => {
      const provider = createFakeProvider()
      provider.embed.mockRejectedValue(
        new EmbeddingProviderError('upstream timeout', { retryable: true })
      )
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const warnSpy = vi.spyOn(logger, 'warn')

      const result = await getSearchQueryEmbedding({
        parsedQuery: parseSearchQuery('coffee'),
        sort: 'relevance',
        consumeRateLimit: () => true,
        getDb: () => mockDb
      })

      expect(result).toBeNull()
      expect(recordSemanticFailure).toHaveBeenCalledWith(
        mockDb,
        'upstream timeout'
      )
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('scheduleEmbeddingJob', () => {
    it('publishes at most once per 10s bucket and always publishes continuations', async () => {
      await scheduleEmbeddingJob(false, 10_000)
      await scheduleEmbeddingJob(false, 19_999)

      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenLastCalledWith({
        id: 'semantic-embed-1',
        name: EMBED_SEARCH_DOCUMENTS_JOB_NAME,
        data: {},
        delaySeconds: 10
      })

      await scheduleEmbeddingJob(false, 20_000)
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish).toHaveBeenLastCalledWith({
        id: 'semantic-embed-2',
        name: EMBED_SEARCH_DOCUMENTS_JOB_NAME,
        data: {},
        delaySeconds: 10
      })

      await scheduleEmbeddingJob(true, 20_001)
      await scheduleEmbeddingJob(true, 20_002)
      expect(publish).toHaveBeenCalledTimes(4)
      const thirdId = publish.mock.calls[2]?.[0]?.id
      const fourthId = publish.mock.calls[3]?.[0]?.id
      expect(thirdId).toMatch(/^semantic-embed-/)
      expect(fourthId).toMatch(/^semantic-embed-/)
      expect(thirdId).not.toBe(fourthId)
    })

    it('publishes with a unique id on every call when the queue runs inline', async () => {
      vi.mocked(getQueue).mockReturnValue({
        publish,
        handle: vi.fn(),
        runsInline: true,
        dropsDelayedJobs: true
      } as unknown as ReturnType<typeof getQueue>)

      await scheduleEmbeddingJob(false, 10_000)
      await scheduleEmbeddingJob(false, 10_001)
      await scheduleEmbeddingJob(false, 10_002)

      expect(publish).toHaveBeenCalledTimes(3)
      const ids = publish.mock.calls.map((call) => call[0]?.id as string)
      for (const id of ids) {
        expect(id).toMatch(/^semantic-embed-/)
      }
      expect(new Set(ids).size).toBe(3)
      expect(publish).toHaveBeenLastCalledWith({
        id: ids[2],
        name: EMBED_SEARCH_DOCUMENTS_JOB_NAME,
        data: {}
      })
    })

    it('lets the next call in the same bucket retry after a failed publish', async () => {
      publish
        .mockRejectedValueOnce(new Error('queue unavailable'))
        .mockResolvedValueOnce(undefined)

      await expect(scheduleEmbeddingJob(false, 30_000)).rejects.toThrow(
        'queue unavailable'
      )
      await expect(scheduleEmbeddingJob(false, 30_500)).resolves.toBeUndefined()
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 'semantic-embed-3' })
      )
      expect(publish).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 'semantic-embed-3' })
      )

      // Once published, further calls in the same bucket are folded.
      await scheduleEmbeddingJob(false, 31_000)
      expect(publish).toHaveBeenCalledTimes(2)
    })
  })

  describe('runEmbeddingJob', () => {
    it('rethrows retryable provider errors after recording the health failure', async () => {
      const provider = createFakeProvider()
      const error = new EmbeddingProviderError('HTTP 503', {
        statusCode: 503,
        retryable: true
      })
      provider.embed.mockRejectedValue(error)
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(claimPendingEmbeddings).mockResolvedValue([
        { documentId: 'doc-1', pendingSince: '2026-01-01 00:00:01+00' }
      ])
      vi.mocked(getEmbeddableDocuments).mockResolvedValue([
        { id: 'doc-1', documentText: 'hello world' }
      ])

      await expect(runEmbeddingJob(mockDb)).rejects.toBe(error)
      const claimToken = vi.mocked(claimPendingEmbeddings).mock.calls[0]?.[2]
      expect(claimToken).toEqual(expect.any(String))
      expect(releaseEmbeddingClaims).toHaveBeenCalledWith(
        mockDb,
        ['doc-1'],
        claimToken
      )
      expect(markEmbeddingsFailed).not.toHaveBeenCalled()
      expect(recordSemanticFailure).toHaveBeenCalledWith(mockDb, 'HTTP 503')
      expect(recordSemanticSuccess).not.toHaveBeenCalled()
    })

    it('backs off rows when the provider refuses the key, keeps marks, records failure once, and schedules no continuation', async () => {
      const provider = createFakeProvider()
      const error = new EmbeddingProviderError('invalid API key', {
        statusCode: 401,
        retryable: false
      })
      provider.embed.mockRejectedValue(error)
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(claimPendingEmbeddings).mockResolvedValue([
        { documentId: 'doc-1', pendingSince: '2026-01-01 00:00:01+00' },
        { documentId: 'doc-2', pendingSince: '2026-01-01 00:00:02+00' }
      ])
      vi.mocked(getEmbeddableDocuments).mockResolvedValue([
        { id: 'doc-1', documentText: 'hello world' },
        { id: 'doc-2', documentText: 'another post' }
      ])
      vi.mocked(hasClaimablePendingEmbeddings).mockResolvedValue(true)

      await expect(runEmbeddingJob(mockDb)).resolves.toBeUndefined()
      const claimToken = vi.mocked(claimPendingEmbeddings).mock.calls[0]?.[2]
      expect(claimToken).toEqual(expect.any(String))
      // One request, not one per document; nothing cleared, rows backed off.
      expect(provider.embed).toHaveBeenCalledTimes(1)
      expect(clearEmbeddingPending).not.toHaveBeenCalled()
      expect(releaseEmbeddingClaims).not.toHaveBeenCalled()
      expect(markEmbeddingsFailed).toHaveBeenCalledWith(
        mockDb,
        ['doc-1', 'doc-2'],
        expect.objectContaining({ claimToken })
      )
      expect(recordSemanticFailure).toHaveBeenCalledTimes(1)
      expect(recordSemanticFailure).toHaveBeenCalledWith(
        mockDb,
        'invalid API key'
      )
      expect(recordSemanticSuccess).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    it('treats a single refused document as an input refusal without throwing, backs it off, and continues the job', async () => {
      const provider = createFakeProvider()
      const error = new EmbeddingProviderError('input too long', {
        statusCode: 400,
        retryable: false
      })
      provider.embed.mockImplementation(async (texts: string[]) => {
        if (texts.includes('refused single post')) throw error
        return texts.map((_, index) => [index + 1, 0, 0, 0])
      })
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      let passNumber = 0
      vi.mocked(claimPendingEmbeddings).mockImplementation(async () => {
        passNumber += 1
        if (passNumber === 1) {
          return [
            { documentId: 'doc-1', pendingSince: '2026-01-01 00:00:01+00' }
          ]
        }
        // Pass 1 had a refusal and 0 embedded docs, so success must not have been recorded yet.
        expect(recordSemanticSuccess).not.toHaveBeenCalled()
        return [{ documentId: 'doc-2', pendingSince: '2026-01-01 00:00:02+00' }]
      })
      vi.mocked(getEmbeddableDocuments).mockImplementation(async (_db, ids) =>
        ids.map((id) => ({
          id,
          documentText:
            id === 'doc-1' ? 'refused single post' : 'good next post'
        }))
      )
      vi.mocked(hasClaimablePendingEmbeddings)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      await expect(runEmbeddingJob(mockDb)).resolves.toBeUndefined()
      const firstToken = vi.mocked(claimPendingEmbeddings).mock.calls[0]?.[2]
      const secondToken = vi.mocked(claimPendingEmbeddings).mock.calls[1]?.[2]
      expect(firstToken).toEqual(expect.any(String))
      expect(secondToken).toEqual(expect.any(String))
      expect(claimPendingEmbeddings).toHaveBeenCalledTimes(2)
      expect(clearEmbeddingPending).not.toHaveBeenCalled()
      expect(markEmbeddingsFailed).toHaveBeenCalledTimes(1)
      expect(markEmbeddingsFailed).toHaveBeenCalledWith(
        mockDb,
        ['doc-1'],
        expect.objectContaining({ claimToken: firstToken })
      )
      expect(recordSemanticFailure).toHaveBeenCalledWith(
        mockDb,
        'the provider refused 1 document(s) as input: input too long'
      )
      expect(storeEmbeddings).toHaveBeenCalledTimes(1)
      expect(storeEmbeddings).toHaveBeenCalledWith(
        mockDb,
        [expect.objectContaining({ documentId: 'doc-2' })],
        expect.objectContaining({ claimToken: secondToken })
      )
      expect(recordSemanticSuccess).toHaveBeenCalledTimes(1)
      expect(publish).not.toHaveBeenCalled()
    })

    it('narrows a batch when first and last probes are refused but the middle probe succeeds', async () => {
      const provider = createFakeProvider({ maxBatchSize: 16 })
      const refusalError = new EmbeddingProviderError('input too long', {
        statusCode: 400,
        retryable: false
      })
      provider.embed.mockImplementation(async (texts: string[]) => {
        if (texts.some((text) => text.startsWith('bad-'))) throw refusalError
        return texts.map((_, index) => [index + 1, 0, 0, 0])
      })
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const pending = Array.from({ length: 5 }, (_, index) => ({
        documentId: `doc-${index}`,
        pendingSince: `2026-01-01 00:00:0${index + 1}+00`
      }))
      const docs = [
        { id: 'doc-0', documentText: 'bad-first' },
        { id: 'doc-1', documentText: 'good-second' },
        { id: 'doc-2', documentText: 'good-middle' },
        { id: 'doc-3', documentText: 'good-fourth' },
        { id: 'doc-4', documentText: 'bad-last' }
      ]
      vi.mocked(claimPendingEmbeddings).mockResolvedValueOnce(pending)
      vi.mocked(getEmbeddableDocuments).mockImplementation(async (_db, ids) =>
        docs.filter((doc) => ids.includes(doc.id))
      )

      await expect(runEmbeddingJob(mockDb)).resolves.toBeUndefined()
      const claimToken = vi.mocked(claimPendingEmbeddings).mock.calls[0]?.[2]
      expect(storeEmbeddings).toHaveBeenCalledTimes(1)
      const storedIds = vi
        .mocked(storeEmbeddings)
        .mock.calls[0]?.[1].map((write) => write.documentId)
        .sort()
      expect(storedIds).toEqual(['doc-1', 'doc-2', 'doc-3'])
      expect(markEmbeddingsFailed).toHaveBeenCalledTimes(1)
      expect(markEmbeddingsFailed).toHaveBeenCalledWith(
        mockDb,
        ['doc-0', 'doc-4'],
        expect.objectContaining({ claimToken })
      )
      expect(recordSemanticFailure).toHaveBeenCalledWith(
        mockDb,
        'the provider refused 2 document(s) as input: input too long'
      )
      expect(recordSemanticSuccess).not.toHaveBeenCalled()
    })

    it('treats a batch as a request-wide failure and backs off all documents when first, middle, and last probes are all refused', async () => {
      const provider = createFakeProvider({ maxBatchSize: 16 })
      const refusalError = new EmbeddingProviderError('bad request', {
        statusCode: 400,
        retryable: false
      })
      provider.embed.mockImplementation(async (texts: string[]) => {
        if (texts.some((text) => text.startsWith('bad-'))) throw refusalError
        return texts.map((_, index) => [index + 1, 0, 0, 0])
      })
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const pending = Array.from({ length: 5 }, (_, index) => ({
        documentId: `doc-${index}`,
        pendingSince: `2026-01-01 00:00:0${index + 1}+00`
      }))
      const docs = [
        { id: 'doc-0', documentText: 'bad-first' },
        { id: 'doc-1', documentText: 'good-second' },
        { id: 'doc-2', documentText: 'bad-middle' },
        { id: 'doc-3', documentText: 'good-fourth' },
        { id: 'doc-4', documentText: 'bad-last' }
      ]
      vi.mocked(claimPendingEmbeddings).mockResolvedValueOnce(pending)
      vi.mocked(getEmbeddableDocuments).mockImplementation(async (_db, ids) =>
        docs.filter((doc) => ids.includes(doc.id))
      )
      vi.mocked(hasClaimablePendingEmbeddings).mockResolvedValue(true)

      await expect(runEmbeddingJob(mockDb)).resolves.toBeUndefined()
      const claimToken = vi.mocked(claimPendingEmbeddings).mock.calls[0]?.[2]
      // Full batch plus first, middle, and last single-document probes only.
      expect(provider.embed).toHaveBeenCalledTimes(4)
      expect(storeEmbeddings).not.toHaveBeenCalled()
      expect(markEmbeddingsFailed).toHaveBeenCalledTimes(1)
      expect(markEmbeddingsFailed).toHaveBeenCalledWith(
        mockDb,
        ['doc-0', 'doc-1', 'doc-2', 'doc-3', 'doc-4'],
        expect.objectContaining({ claimToken })
      )
      expect(recordSemanticFailure).toHaveBeenCalledTimes(1)
      expect(recordSemanticFailure).toHaveBeenCalledWith(mockDb, 'bad request')
      expect(recordSemanticSuccess).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    it('processes up to EMBEDDING_JOB_MAX_PASSES batches on a real queue, then publishes one continuation', async () => {
      const provider = createFakeProvider({ maxBatchSize: 64 })
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const pending = Array.from(
        { length: EMBEDDING_JOB_BATCH_SIZE },
        (_, index) => ({
          documentId: `doc-${index}`,
          pendingSince: `2026-01-01 00:00:${String(index).padStart(2, '0')}+00`
        })
      )
      vi.mocked(claimPendingEmbeddings).mockResolvedValue(pending)
      vi.mocked(getEmbeddableDocuments).mockResolvedValue(
        pending.map((item) => ({
          id: item.documentId,
          documentText: `post ${item.documentId}`
        }))
      )
      vi.mocked(hasClaimablePendingEmbeddings).mockResolvedValue(true)

      await runEmbeddingJob(mockDb)

      const firstToken = vi.mocked(claimPendingEmbeddings).mock.calls[0]?.[2]
      expect(firstToken).toEqual(expect.any(String))
      expect(claimPendingEmbeddings).toHaveBeenCalledTimes(
        EMBEDDING_JOB_MAX_PASSES
      )
      expect(storeEmbeddings).toHaveBeenCalledTimes(EMBEDDING_JOB_MAX_PASSES)
      expect(storeEmbeddings).toHaveBeenNthCalledWith(
        1,
        mockDb,
        expect.any(Array),
        expect.objectContaining({
          model: provider.model,
          dimensions: provider.dimensions,
          claimToken: firstToken
        })
      )
      expect(recordSemanticSuccess).toHaveBeenCalledTimes(
        EMBEDDING_JOB_MAX_PASSES
      )
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: EMBED_SEARCH_DOCUMENTS_JOB_NAME,
          data: {},
          delaySeconds: 10
        })
      )

      // When claimable rows run out before the pass cap, no continuation is scheduled.
      vi.mocked(claimPendingEmbeddings).mockClear()
      vi.mocked(hasClaimablePendingEmbeddings)
        .mockReset()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
      await runEmbeddingJob(mockDb)
      expect(claimPendingEmbeddings).toHaveBeenCalledTimes(2)
      expect(publish).toHaveBeenCalledTimes(1)
    })

    it('loops past EMBEDDING_JOB_MAX_PASSES under an inline queue, stops at EMBEDDING_INLINE_JOB_MAX_PASSES, and never publishes a continuation', async () => {
      const provider = createFakeProvider({ maxBatchSize: 64 })
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(getQueue).mockReturnValue({
        publish,
        handle: vi.fn(),
        runsInline: true,
        dropsDelayedJobs: true
      } as unknown as ReturnType<typeof getQueue>)
      const pending = [
        { documentId: 'doc-inline', pendingSince: '2026-01-01 00:00:01+00' }
      ]
      vi.mocked(claimPendingEmbeddings).mockResolvedValue(pending)
      vi.mocked(getEmbeddableDocuments).mockResolvedValue([
        { id: 'doc-inline', documentText: 'inline post' }
      ])

      // Loops past EMBEDDING_JOB_MAX_PASSES (8) while claimable rows remain (10 passes).
      let claimChecks = 0
      vi.mocked(hasClaimablePendingEmbeddings).mockImplementation(async () => {
        claimChecks += 1
        return claimChecks < 10
      })
      await runEmbeddingJob(mockDb)
      expect(claimPendingEmbeddings).toHaveBeenCalledTimes(10)
      expect(storeEmbeddings).toHaveBeenCalledTimes(10)
      expect(publish).not.toHaveBeenCalled()

      // Stops at the EMBEDDING_INLINE_JOB_MAX_PASSES safety bound when always claimable.
      vi.mocked(claimPendingEmbeddings).mockClear()
      vi.mocked(storeEmbeddings).mockClear()
      vi.mocked(hasClaimablePendingEmbeddings)
        .mockReset()
        .mockResolvedValue(true)
      await runEmbeddingJob(mockDb)
      expect(claimPendingEmbeddings).toHaveBeenCalledTimes(
        EMBEDDING_INLINE_JOB_MAX_PASSES
      )
      expect(storeEmbeddings).toHaveBeenCalledTimes(
        EMBEDDING_INLINE_JOB_MAX_PASSES
      )
      expect(publish).not.toHaveBeenCalled()

      // Stops immediately when nothing is claimable on the first pass.
      vi.mocked(claimPendingEmbeddings).mockReset().mockResolvedValue([])
      vi.mocked(storeEmbeddings).mockClear()
      vi.mocked(hasClaimablePendingEmbeddings).mockClear()
      await runEmbeddingJob(mockDb)
      expect(claimPendingEmbeddings).toHaveBeenCalledTimes(1)
      expect(storeEmbeddings).not.toHaveBeenCalled()
      expect(hasClaimablePendingEmbeddings).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  })

  describe('getDocumentsNeedingEmbedding', () => {
    it('returns documents with missing, unembedded, stale hash, wrong model, or wrong dimensions, and excludes empty and up-to-date documents', async () => {
      const provider = createFakeProvider({
        model: 'embed-v2',
        dimensions: 4
      })
      const upToDateText = 'already embedded unchanged post'
      const changedText = 'edited post with new words'
      const wrongModelText = 'embedded under old model'
      const wrongDimsText = 'embedded under old dimensions'
      const unembeddedText = 'pending row with null embedding'
      const missingText = 'brand new post with no row'

      const documents = [
        { id: 'doc-missing', documentText: missingText },
        { id: 'doc-unembedded', documentText: unembeddedText },
        { id: 'doc-hash-changed', documentText: changedText },
        { id: 'doc-model-changed', documentText: wrongModelText },
        { id: 'doc-dims-changed', documentText: wrongDimsText },
        { id: 'doc-empty', documentText: '' },
        { id: 'doc-whitespace', documentText: '   \n\t  ' },
        { id: 'doc-up-to-date', documentText: upToDateText }
      ]

      vi.mocked(getStoredEmbeddings).mockResolvedValue(
        new Map([
          [
            'doc-unembedded',
            {
              documentId: 'doc-unembedded',
              model: provider.model,
              dimensions: provider.dimensions,
              contentHash: getEmbeddingContentHash(unembeddedText),
              hasEmbedding: false
            }
          ],
          [
            'doc-hash-changed',
            {
              documentId: 'doc-hash-changed',
              model: provider.model,
              dimensions: provider.dimensions,
              contentHash: getEmbeddingContentHash('older text before edit'),
              hasEmbedding: true
            }
          ],
          [
            'doc-model-changed',
            {
              documentId: 'doc-model-changed',
              model: 'embed-v1',
              dimensions: provider.dimensions,
              contentHash: getEmbeddingContentHash(wrongModelText),
              hasEmbedding: true
            }
          ],
          [
            'doc-dims-changed',
            {
              documentId: 'doc-dims-changed',
              model: provider.model,
              dimensions: 8,
              contentHash: getEmbeddingContentHash(wrongDimsText),
              hasEmbedding: true
            }
          ],
          [
            'doc-up-to-date',
            {
              documentId: 'doc-up-to-date',
              model: provider.model,
              dimensions: provider.dimensions,
              contentHash: getEmbeddingContentHash(upToDateText),
              hasEmbedding: true
            }
          ]
        ])
      )

      const needing = await getDocumentsNeedingEmbedding(
        mockDb,
        provider,
        documents
      )

      expect(getStoredEmbeddings).toHaveBeenCalledWith(
        mockDb,
        documents.map((doc) => doc.id)
      )
      expect(needing.map((doc) => doc.id)).toEqual([
        'doc-missing',
        'doc-unembedded',
        'doc-hash-changed',
        'doc-model-changed',
        'doc-dims-changed'
      ])
    })
  })

  describe('embedDocuments', () => {
    it('fences post-embed drops and writes with the job claim', async () => {
      const provider = createFakeProvider()
      const claim = {
        claimToken: 'claim-token-1',
        pendingSince: new Map([
          ['doc-keep', '2026-01-01 00:00:01+00'],
          ['doc-optout', '2026-01-01 00:00:02+00']
        ])
      }
      vi.mocked(getEmbeddableDocuments).mockResolvedValue([
        { id: 'doc-keep', documentText: 'stays public' }
      ])

      const result = await embedDocuments(
        mockDb,
        provider,
        [
          { id: 'doc-keep', documentText: 'stays public' },
          { id: 'doc-optout', documentText: 'author opts out mid-embed' }
        ],
        claim
      )

      expect(result).toEqual({ sent: 2, embedded: 2, refused: [] })
      expect(deleteEmbeddings).toHaveBeenCalledWith(
        mockDb,
        ['doc-optout'],
        claim
      )
      expect(storeEmbeddings).toHaveBeenCalledWith(
        mockDb,
        [
          expect.objectContaining({
            documentId: 'doc-keep',
            pendingSince: '2026-01-01 00:00:01+00'
          })
        ],
        expect.objectContaining({
          model: provider.model,
          dimensions: provider.dimensions,
          claimToken: claim.claimToken
        })
      )
    })

    it('yields no refusal when a batch 413 splits cleanly with no refused documents', async () => {
      const provider = createFakeProvider({ maxBatchSize: 16 })
      const batchTooLarge = new EmbeddingProviderError('payload too large', {
        statusCode: 413,
        retryable: false
      })
      provider.embed.mockImplementation(async (texts: string[]) => {
        if (texts.length > 2) throw batchTooLarge
        return texts.map((_, index) => [index + 1, 0, 0, 0])
      })
      const docs = Array.from({ length: 6 }, (_, index) => ({
        id: `doc-${index}`,
        documentText: `post number ${index}`
      }))
      const claim = {
        claimToken: 'claim-413-clean',
        pendingSince: new Map(
          docs.map((doc, index) => [
            doc.id,
            `2026-01-01 00:00:0${index + 1}+00`
          ])
        )
      }
      vi.mocked(getEmbeddableDocuments).mockResolvedValue(docs)

      const result = await embedDocuments(mockDb, provider, docs, claim)

      expect(result).toEqual({ sent: 6, embedded: 6, refused: [] })
      expect(result.refusal).toBeUndefined()
      const storedIds = vi
        .mocked(storeEmbeddings)
        .mock.calls[0]?.[1].map((write) => write.documentId)
        .sort()
      expect(storedIds).toEqual(docs.map((doc) => doc.id).sort())
    })

    it("reports a refused document's own error from halving rather than the batch 413 error", async () => {
      const provider = createFakeProvider({ maxBatchSize: 16 })
      const batchTooLarge = new EmbeddingProviderError(
        'batch payload too large',
        { statusCode: 413, retryable: false }
      )
      const docRefusal = new EmbeddingProviderError(
        'document exceeds token limit',
        { statusCode: 400, retryable: false }
      )
      provider.embed.mockImplementation(async (texts: string[]) => {
        if (texts.length > 1) throw batchTooLarge
        if (texts[0] === 'bad-in-rest') throw docRefusal
        return [[1, 0, 0, 0]]
      })
      // Probes for length 5 are indexes 0, 2, 4; index 1 is isolated by halving rest.
      const docs = [
        { id: 'doc-0', documentText: 'good-0' },
        { id: 'doc-1', documentText: 'bad-in-rest' },
        { id: 'doc-2', documentText: 'good-2' },
        { id: 'doc-3', documentText: 'good-3' },
        { id: 'doc-4', documentText: 'good-4' }
      ]
      const claim = {
        claimToken: 'claim-413-rest-refusal',
        pendingSince: new Map(
          docs.map((doc, index) => [
            doc.id,
            `2026-01-01 00:00:0${index + 1}+00`
          ])
        )
      }
      vi.mocked(getEmbeddableDocuments).mockResolvedValue(docs)

      const result = await embedDocuments(mockDb, provider, docs, claim)

      expect(result).toEqual({
        sent: 5,
        embedded: 4,
        refused: ['doc-1'],
        refusal: docRefusal
      })
      expect(result.refusal).toBe(docRefusal)
    })

    it("reports a refused probe document's own error rather than the batch 413 error", async () => {
      const provider = createFakeProvider({ maxBatchSize: 16 })
      const batchTooLarge = new EmbeddingProviderError(
        'batch payload too large',
        { statusCode: 413, retryable: false }
      )
      const probeRefusal = new EmbeddingProviderError(
        'invalid input encoding',
        {
          statusCode: 422,
          retryable: false
        }
      )
      provider.embed.mockImplementation(async (texts: string[]) => {
        if (texts.length > 2) throw batchTooLarge
        if (texts.includes('bad-probe')) throw probeRefusal
        return texts.map((_, index) => [index + 1, 0, 0, 0])
      })
      // Index 0 is a probe; rest ([doc-1, doc-3]) succeeds with no refusals.
      const docs = [
        { id: 'doc-0', documentText: 'bad-probe' },
        { id: 'doc-1', documentText: 'good-1' },
        { id: 'doc-2', documentText: 'good-2' },
        { id: 'doc-3', documentText: 'good-3' },
        { id: 'doc-4', documentText: 'good-4' }
      ]
      const claim = {
        claimToken: 'claim-413-probe-refusal',
        pendingSince: new Map(
          docs.map((doc, index) => [
            doc.id,
            `2026-01-01 00:00:0${index + 1}+00`
          ])
        )
      }
      vi.mocked(getEmbeddableDocuments).mockResolvedValue(docs)

      const result = await embedDocuments(mockDb, provider, docs, claim)

      expect(result).toEqual({
        sent: 5,
        embedded: 4,
        refused: ['doc-0'],
        refusal: probeRefusal
      })
      expect(result.refusal).toBe(probeRefusal)
    })
  })

  describe('createSemanticSearchListener and semanticHooks', () => {
    it('marks documents pending before scheduling the embedding job', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const callOrder: string[] = []
      vi.mocked(markEmbeddingsPending).mockImplementation(async () => {
        callOrder.push('markPending')
        return 2
      })
      publish.mockImplementation(async () => {
        callOrder.push('scheduleJob')
      })

      const listener = createSemanticSearchListener(() => mockDb)
      listener.statusDocumentsWritten(['doc-1', 'doc-2'])
      await flushMicrotasks()

      expect(callOrder).toEqual(['markPending', 'scheduleJob'])
      expect(markEmbeddingsPending).toHaveBeenCalledWith(
        mockDb,
        ['doc-1', 'doc-2'],
        provider
      )
      expect(publish).toHaveBeenCalledTimes(1)
    })

    it('does not schedule an embedding job when nothing was marked pending', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(markEmbeddingsPending).mockResolvedValue(0)

      const listener = createSemanticSearchListener(() => mockDb)
      listener.statusDocumentsWritten(['doc-followers-only'])
      await flushMicrotasks()

      expect(markEmbeddingsPending).toHaveBeenCalledWith(
        mockDb,
        ['doc-followers-only'],
        provider
      )
      expect(publish).not.toHaveBeenCalled()
    })

    it('never throws when marking pending or scheduling fails', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(markEmbeddingsPending).mockRejectedValue(
        new Error('db connection lost')
      )
      const warnSpy = vi.spyOn(logger, 'warn')

      const listener = createSemanticSearchListener(() => mockDb)
      expect(() => listener.statusDocumentsWritten(['doc-1'])).not.toThrow()
      await flushMicrotasks()

      expect(publish).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it("marks an actor's documents pending on actorIndexed and schedules a job", async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(getActorStatusDocumentIds).mockResolvedValue(['doc-1', 'doc-2'])
      vi.mocked(markEmbeddingsPending).mockResolvedValue(2)

      const listener = createSemanticSearchListener(() => mockDb)
      listener.actorIndexed('https://remote.test/users/bob')
      await flushMicrotasks()

      expect(getActorStatusDocumentIds).toHaveBeenCalledWith(
        mockDb,
        'https://remote.test/users/bob'
      )
      expect(markEmbeddingsPending).toHaveBeenCalledWith(
        mockDb,
        ['doc-1', 'doc-2'],
        provider
      )
      expect(publish).toHaveBeenCalledTimes(1)
    })

    it('throttles actorIndexed to once per 24 hours per actor and resets via resetActorOptInsForTests', async () => {
      const DAY_MS = 24 * 60 * 60 * 1000
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(getActorStatusDocumentIds).mockResolvedValue(['doc-1'])
      vi.mocked(markEmbeddingsPending).mockResolvedValue(1)

      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      try {
        const listener = createSemanticSearchListener(() => mockDb)
        const bob = 'https://remote.test/users/bob'
        const alice = 'https://remote.test/users/alice'

        // Calling twice in a row for the same actor only marks once.
        listener.actorIndexed(bob)
        listener.actorIndexed(bob)
        await flushMicrotasks()
        expect(markEmbeddingsPending).toHaveBeenCalledTimes(1)

        // A different actor in the same 24h window is still marked.
        listener.actorIndexed(alice)
        await flushMicrotasks()
        expect(markEmbeddingsPending).toHaveBeenCalledTimes(2)

        // Just under 24 hours later, bob is still throttled.
        vi.advanceTimersByTime(DAY_MS - 1)
        listener.actorIndexed(bob)
        await flushMicrotasks()
        expect(markEmbeddingsPending).toHaveBeenCalledTimes(2)

        // Once 24 hours have elapsed, bob is marked again.
        vi.advanceTimersByTime(1)
        listener.actorIndexed(bob)
        await flushMicrotasks()
        expect(markEmbeddingsPending).toHaveBeenCalledTimes(3)

        // Immediately afterwards bob is throttled again until resetActorOptInsForTests.
        listener.actorIndexed(bob)
        await flushMicrotasks()
        expect(markEmbeddingsPending).toHaveBeenCalledTimes(3)

        resetActorOptInsForTests()
        listener.actorIndexed(bob)
        await flushMicrotasks()
        expect(markEmbeddingsPending).toHaveBeenCalledTimes(4)
      } finally {
        vi.useRealTimers()
      }
    })

    it('takes the actorIndexed throttle slot before querying and releases it when no qualifying posts exist or marking fails', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      const warnSpy = vi.spyOn(logger, 'warn')
      const listener = createSemanticSearchListener(() => mockDb)

      // 1. Slot is taken before querying: a throttled second call (even concurrent)
      // never calls getActorStatusDocumentIds.
      const bob = 'https://remote.test/users/bob'
      let resolveBobQuery!: (ids: string[]) => void
      vi.mocked(getActorStatusDocumentIds).mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            resolveBobQuery = resolve
          })
      )
      vi.mocked(markEmbeddingsPending).mockResolvedValue(1)

      listener.actorIndexed(bob)
      listener.actorIndexed(bob)
      await flushMicrotasks()
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(1)

      resolveBobQuery(['doc-bob-1'])
      await flushMicrotasks()
      expect(markEmbeddingsPending).toHaveBeenCalledTimes(1)

      // A later call within the 24h window also skips querying getActorStatusDocumentIds.
      listener.actorIndexed(bob)
      await flushMicrotasks()
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(1)
      expect(markEmbeddingsPending).toHaveBeenCalledTimes(1)

      // 2. When getActorStatusDocumentIds returns [], the slot is released so a later call queries again.
      const carol = 'https://remote.test/users/carol'
      vi.mocked(getActorStatusDocumentIds)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['doc-carol-1'])

      listener.actorIndexed(carol)
      await flushMicrotasks()
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(2)
      expect(markEmbeddingsPending).toHaveBeenCalledTimes(1)

      listener.actorIndexed(carol)
      await flushMicrotasks()
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(3)
      expect(markEmbeddingsPending).toHaveBeenCalledTimes(2)
      expect(markEmbeddingsPending).toHaveBeenLastCalledWith(
        mockDb,
        ['doc-carol-1'],
        provider
      )

      // Once carol's posts were marked, she is throttled and does not query again.
      listener.actorIndexed(carol)
      await flushMicrotasks()
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(3)

      // 3. When marking fails, the slot is released so a subsequent call retries.
      const dave = 'https://remote.test/users/dave'
      vi.mocked(getActorStatusDocumentIds).mockResolvedValue(['doc-dave-1'])
      vi.mocked(markEmbeddingsPending)
        .mockRejectedValueOnce(new Error('transient db error'))
        .mockResolvedValueOnce(1)

      listener.actorIndexed(dave)
      await flushMicrotasks()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(4)

      listener.actorIndexed(dave)
      await flushMicrotasks()
      expect(getActorStatusDocumentIds).toHaveBeenCalledTimes(5)
      expect(markEmbeddingsPending).toHaveBeenCalledTimes(4)
    })

    it('drops actor embeddings on actorUnindexed and swallows errors', async () => {
      const provider = createFakeProvider()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(deleteEmbeddingsForActor).mockRejectedValueOnce(
        new Error('delete failed')
      )
      const warnSpy = vi.spyOn(logger, 'warn')

      const listener = createSemanticSearchListener(() => mockDb)
      expect(() =>
        listener.actorUnindexed('https://remote.test/users/bob')
      ).not.toThrow()
      await flushMicrotasks()

      expect(deleteEmbeddingsForActor).toHaveBeenCalledWith(
        mockDb,
        'https://remote.test/users/bob'
      )
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('swallows synchronous throws from a registered semantic hook listener', () => {
      setSemanticSearchListener({
        statusDocumentsWritten() {
          throw new Error('sync boom')
        },
        actorUnindexed() {
          throw new Error('sync actor boom')
        },
        actorIndexed() {
          throw new Error('sync actor boom')
        }
      })

      expect(() => notifyStatusDocumentsWritten(['doc-1'])).not.toThrow()
      expect(() =>
        notifyActorUnindexed('https://remote.test/users/bob')
      ).not.toThrow()
    })
  })
})
