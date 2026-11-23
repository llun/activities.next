import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GeminiSearchEmbeddingsConfig } from '@/lib/config/searchEmbeddings'
import {
  SafeRemoteFetch,
  SafeRemoteFetchError
} from '@/lib/utils/safeRemoteFetch'

import { GEMINI_MAX_BATCH_SIZE, createGeminiEmbeddingProvider } from './gemini'
import { EmbeddingProviderError } from './types'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const loadFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), 'utf8')

const GEMINI_001_CONFIG: GeminiSearchEmbeddingsConfig = {
  provider: 'gemini',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'gemini-secret-fixture-key',
  model: 'gemini-embedding-001',
  dimensions: 3,
  allowPrivateEndpoint: false
}

const GEMINI_2_CONFIG: GeminiSearchEmbeddingsConfig = {
  provider: 'gemini',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'gemini-secret-fixture-key',
  model: 'gemini-embedding-2-preview',
  dimensions: 3,
  allowPrivateEndpoint: false
}

describe('createGeminiEmbeddingProvider', () => {
  it('exposes provider metadata and cacheKey', () => {
    const fetcher = vi.fn<SafeRemoteFetch>()
    const provider = createGeminiEmbeddingProvider(GEMINI_001_CONFIG, fetcher)

    expect(provider.cacheKey).toBe('gemini:gemini-embedding-001:3')
    expect(provider.model).toBe('gemini-embedding-001')
    expect(provider.dimensions).toBe(3)
    expect(provider.maxBatchSize).toBe(GEMINI_MAX_BATCH_SIZE)
    expect(provider.maxBatchSize).toBe(100)
  })

  it('returns an empty array without calling fetcher for empty input', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>()
    const provider = createGeminiEmbeddingProvider(GEMINI_001_CONFIG, fetcher)

    await expect(provider.embed([], 'document')).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    {
      model: 'gemini-embedding-001',
      kind: 'query' as const,
      expectedTaskType: 'RETRIEVAL_QUERY'
    },
    {
      model: 'gemini-embedding-001',
      kind: 'document' as const,
      expectedTaskType: 'RETRIEVAL_DOCUMENT'
    },
    {
      model: 'text-embedding-004',
      kind: 'query' as const,
      expectedTaskType: 'RETRIEVAL_QUERY'
    }
  ])(
    'sends taskType=$expectedTaskType and raw text for $model ($kind)',
    async ({ model, kind, expectedTaskType }) => {
      const fixtureBody = loadFixture('geminiEmbeddingsResponse.json')
      const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
        statusCode: 200,
        body: fixtureBody,
        bodyTruncated: false,
        headers: {},
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`
      })

      const provider = createGeminiEmbeddingProvider(
        { ...GEMINI_001_CONFIG, model },
        fetcher
      )
      const controller = new AbortController()
      const vectors = await provider.embed(['hello world', 'second'], kind, {
        timeoutMs: 2500,
        signal: controller.signal
      })

      expect(vectors).toEqual([
        [0.11, 0.22, 0.33],
        [0.44, 0.55, 0.66]
      ])

      const request = fetcher.mock.calls[0]?.[0]
      expect(request?.url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`
      )
      expect(request?.url).not.toContain('gemini-secret-fixture-key')
      expect(request?.method).toBe('POST')
      expect(request?.headers).toEqual({
        'x-goog-api-key': 'gemini-secret-fixture-key',
        'Content-Type': 'application/json'
      })
      expect(JSON.parse(request?.body ?? '{}')).toEqual({
        requests: [
          {
            model: `models/${model}`,
            content: { parts: [{ text: 'hello world' }] },
            taskType: expectedTaskType,
            outputDimensionality: 3
          },
          {
            model: `models/${model}`,
            content: { parts: [{ text: 'second' }] },
            taskType: expectedTaskType,
            outputDimensionality: 3
          }
        ]
      })
      expect(request?.timeoutInMilliseconds).toBe(2500)
      expect(request?.maxBodyBytes).toBe(16 * 1024 * 1024)
      expect(request?.allowCrossHostRedirects).toBe(false)
      expect(request?.maxRedirects).toBe(0)
      expect(request?.signal).toBe(controller.signal)
    }
  )

  it.each([
    {
      kind: 'query' as const,
      expectedFirstText: 'task: search result | query: trail running shoes',
      expectedSecondText: 'task: search result | query: morning coffee'
    },
    {
      kind: 'document' as const,
      expectedFirstText: 'title: none | text: trail running shoes',
      expectedSecondText: 'title: none | text: morning coffee'
    }
  ])(
    'uses prompt prefixes and omits taskType for gemini-embedding-2* models ($kind)',
    async ({ kind, expectedFirstText, expectedSecondText }) => {
      const fixtureBody = loadFixture('geminiEmbeddingsResponse.json')
      const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
        statusCode: 200,
        body: fixtureBody,
        bodyTruncated: false,
        headers: {},
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents'
      })

      const provider = createGeminiEmbeddingProvider(GEMINI_2_CONFIG, fetcher)
      await provider.embed(['trail running shoes', 'morning coffee'], kind)

      const request = fetcher.mock.calls[0]?.[0]
      expect(request?.timeoutInMilliseconds).toBe(30_000)
      const parsedBody = JSON.parse(request?.body ?? '{}') as {
        requests: Array<Record<string, unknown>>
      }
      expect(parsedBody).toEqual({
        requests: [
          {
            model: 'models/gemini-embedding-2-preview',
            content: { parts: [{ text: expectedFirstText }] },
            outputDimensionality: 3
          },
          {
            model: 'models/gemini-embedding-2-preview',
            content: { parts: [{ text: expectedSecondText }] },
            outputDimensionality: 3
          }
        ]
      })
      for (const item of parsedBody.requests) {
        expect(item).not.toHaveProperty('taskType')
      }
    }
  )

  it('chunks inputs above maxBatchSize (100) and concatenates results in order', async () => {
    const texts = Array.from({ length: 205 }, (_, index) => `doc-${index}`)
    let offset = 0
    const fetcher = vi.fn<SafeRemoteFetch>(async ({ body }) => {
      const parsed = JSON.parse(body ?? '{}') as { requests: unknown[] }
      const start = offset
      offset += parsed.requests.length
      return {
        statusCode: 200,
        body: JSON.stringify({
          embeddings: parsed.requests.map((_item, idx) => ({
            values: [start + idx, 1, 2]
          }))
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
      }
    })

    const provider = createGeminiEmbeddingProvider(GEMINI_001_CONFIG, fetcher)
    const vectors = await provider.embed(texts, 'document')

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(
      fetcher.mock.calls.map(
        ([req]) =>
          (JSON.parse(req.body ?? '{}') as { requests: unknown[] }).requests
            .length
      )
    ).toEqual([100, 100, 5])
    expect(vectors).toHaveLength(205)
    expect(vectors[0]).toEqual([0, 1, 2])
    expect(vectors[100]).toEqual([100, 1, 2])
    expect(vectors[204]).toEqual([204, 1, 2])
  })

  it('throws non-retryable EmbeddingProviderError when vector dimensions mismatch', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        embeddings: [{ values: [0.1, 0.2] }]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
    })

    const provider = createGeminiEmbeddingProvider(GEMINI_001_CONFIG, fetcher)
    const error = (await provider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError

    expect(error).toBeInstanceOf(EmbeddingProviderError)
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('returned 2 dimensions, expected 3')
  })

  it.each([
    ['invalid JSON', 'not-json'],
    ['mismatched vector count', JSON.stringify({ embeddings: [] })],
    [
      'non-finite vector element',
      JSON.stringify({ embeddings: [{ values: [0.1, 'bad', 0.3] }] })
    ]
  ])(
    'throws non-retryable EmbeddingProviderError on malformed response (%s)',
    async (_label, body) => {
      const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
        statusCode: 200,
        body,
        bodyTruncated: false,
        headers: {},
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
      })

      const provider = createGeminiEmbeddingProvider(GEMINI_001_CONFIG, fetcher)
      const error = (await provider
        .embed(['hello'], 'query')
        .catch((caught: unknown) => caught)) as EmbeddingProviderError

      expect(error).toBeInstanceOf(EmbeddingProviderError)
      expect(error.retryable).toBe(false)
      expect(error.cause).toBeUndefined()
      expect('cause' in error).toBe(false)
    }
  )

  it.each([
    { statusCode: 429, retryable: true },
    { statusCode: 500, retryable: true },
    { statusCode: 503, retryable: true },
    { statusCode: 400, retryable: false },
    { statusCode: 401, retryable: false },
    { statusCode: 403, retryable: false },
    { statusCode: 404, retryable: false }
  ])(
    'classifies HTTP $statusCode as retryable=$retryable and never leaks API key',
    async ({ statusCode, retryable }) => {
      const fixtureBody = loadFixture('geminiErrorResponse.json')
      const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
        statusCode,
        body: fixtureBody,
        bodyTruncated: false,
        headers: {},
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
      })

      const provider = createGeminiEmbeddingProvider(GEMINI_001_CONFIG, fetcher)
      const error = (await provider
        .embed(['hello'], 'query')
        .catch((caught: unknown) => caught)) as EmbeddingProviderError

      expect(error).toBeInstanceOf(EmbeddingProviderError)
      expect(error.statusCode).toBe(statusCode)
      expect(error.retryable).toBe(retryable)
      expect(error.message).toContain(String(statusCode))
      expect(error.message).not.toContain('gemini-secret-fixture-key')
      expect(error.cause).toBeUndefined()
      expect('cause' in error).toBe(false)
    }
  )

  it('classifies network failures as retryable, SafeRemoteFetchError as non-retryable, and omits cause', async () => {
    const networkFetcher = vi.fn<SafeRemoteFetch>().mockRejectedValue(
      Object.assign(
        new Error('connect ECONNREFUSED with gemini-secret-fixture-key'),
        {
          code: 'ECONNREFUSED'
        }
      )
    )
    const networkProvider = createGeminiEmbeddingProvider(
      GEMINI_001_CONFIG,
      networkFetcher
    )
    const networkError = (await networkProvider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError
    expect(networkError).toBeInstanceOf(EmbeddingProviderError)
    expect(networkError.retryable).toBe(true)
    expect(networkError.message).not.toContain('gemini-secret-fixture-key')
    expect(networkError.cause).toBeUndefined()
    expect('cause' in networkError).toBe(false)

    const safeErrorFetcher = vi
      .fn<SafeRemoteFetch>()
      .mockRejectedValue(
        new SafeRemoteFetchError(
          'Response body too large',
          'ERR_RESPONSE_TOO_LARGE'
        )
      )
    const safeErrorProvider = createGeminiEmbeddingProvider(
      GEMINI_001_CONFIG,
      safeErrorFetcher
    )
    const safeError = (await safeErrorProvider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError
    expect(safeError).toBeInstanceOf(EmbeddingProviderError)
    expect(safeError.retryable).toBe(false)
    expect(safeError.cause).toBeUndefined()
    expect('cause' in safeError).toBe(false)
  })
})
