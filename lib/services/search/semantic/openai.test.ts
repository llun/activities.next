import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OpenAISearchEmbeddingsConfig } from '@/lib/config/searchEmbeddings'
import {
  SafeRemoteFetch,
  SafeRemoteFetchError
} from '@/lib/utils/safeRemoteFetch'

import {
  OPENAI_DEFAULT_BATCH_SIZE,
  createOpenAIEmbeddingProvider
} from './openai'
import { EmbeddingProviderError } from './types'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const loadFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), 'utf8')

const BASE_CONFIG: OpenAISearchEmbeddingsConfig = {
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-secret-fixture-key',
  model: 'text-embedding-3-small',
  dimensions: 3,
  dimensionsField: 'dimensions',
  batchSize: OPENAI_DEFAULT_BATCH_SIZE,
  timeoutMs: 30_000,
  allowPrivateEndpoint: false
}

const MISTRAL_CONFIG: OpenAISearchEmbeddingsConfig = {
  provider: 'openai',
  endpoint: 'https://api.mistral.ai/v1',
  apiKey: 'mistral-secret-fixture-key',
  model: 'mistral-embed',
  dimensions: 1024,
  dimensionsField: 'none',
  batchSize: 8,
  timeoutMs: 30_000,
  allowPrivateEndpoint: false
}

// The recorded shape of POST https://api.mistral.ai/v1/embeddings: an
// OpenAI-like `{ data: [{ index, embedding, object }], model, usage }`.
// mistral-embed always answers 1024 dimensions, so the vectors are generated
// here rather than stored in a fixture file.
const recordedMistralResponse = (vectors: number[][]) =>
  JSON.stringify({
    object: 'list',
    data: vectors.map((embedding, index) => ({
      object: 'embedding',
      index,
      embedding
    })),
    model: 'mistral-embed',
    usage: { prompt_tokens: 8, total_tokens: 8 }
  })

const mistralVector = (seed: number) =>
  Array.from({ length: 1024 }, (_, index) => seed + index / 1024)

describe('createOpenAIEmbeddingProvider', () => {
  it('exposes provider metadata and cacheKey', () => {
    const fetcher = vi.fn<SafeRemoteFetch>()
    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)

    expect(provider.cacheKey).toBe(
      'openai:https://api.openai.com/v1:text-embedding-3-small:3'
    )
    expect(provider.model).toBe('text-embedding-3-small')
    expect(provider.dimensions).toBe(3)
    expect(provider.maxBatchSize).toBe(OPENAI_DEFAULT_BATCH_SIZE)
    expect(provider.maxBatchSize).toBe(64)
  })

  it('returns an empty array without calling fetcher for empty input', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>()
    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)

    await expect(provider.embed([], 'query')).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('posts expected URL, headers, body, and orders response vectors by index', async () => {
    const fixtureBody = loadFixture('openaiEmbeddingsResponse.json')
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: fixtureBody,
      bodyTruncated: false,
      headers: {},
      url: 'https://api.openai.com/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)
    const controller = new AbortController()
    const vectors = await provider.embed(
      ['first post', 'second post'],
      'document',
      {
        timeoutMs: 2000,
        signal: controller.signal
      }
    )

    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    ])

    expect(fetcher).toHaveBeenCalledTimes(1)
    const request = fetcher.mock.calls[0]?.[0]
    expect(request?.url).toBe('https://api.openai.com/v1/embeddings')
    expect(request?.url).not.toContain('sk-secret-fixture-key')
    expect(request?.method).toBe('POST')
    expect(request?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-secret-fixture-key'
    })
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      model: 'text-embedding-3-small',
      input: ['first post', 'second post'],
      dimensions: 3
    })
    expect(request?.timeoutInMilliseconds).toBe(2000)
    expect(request?.maxBodyBytes).toBe(16 * 1024 * 1024)
    expect(request?.allowCrossHostRedirects).toBe(false)
    expect(request?.maxRedirects).toBe(0)
    expect(request?.signal).toBe(controller.signal)
  })

  it('omits Authorization header when apiKey is unset and uses default 30s timeout', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'http://192.168.1.20:11434/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(
      {
        provider: 'openai',
        endpoint: 'http://192.168.1.20:11434/v1/',
        model: 'nomic-embed-text',
        dimensions: 3,
        dimensionsField: 'none',
        batchSize: 32,
        timeoutMs: 30_000,
        allowPrivateEndpoint: true
      },
      fetcher
    )

    await provider.embed(['hello'], 'query')

    const request = fetcher.mock.calls[0]?.[0]
    expect(request?.url).toBe('http://192.168.1.20:11434/v1/embeddings')
    expect(request?.headers).toEqual({
      'Content-Type': 'application/json'
    })
    expect(request?.timeoutInMilliseconds).toBe(30_000)
  })

  it('chunks inputs above maxBatchSize (64) and concatenates results in order', async () => {
    const texts = Array.from({ length: 130 }, (_, index) => `text-${index}`)
    let callIndex = 0
    const fetcher = vi.fn<SafeRemoteFetch>(async ({ body }) => {
      const parsed = JSON.parse(body ?? '{}') as { input: string[] }
      const batchOffset = callIndex * OPENAI_DEFAULT_BATCH_SIZE
      callIndex += 1
      return {
        statusCode: 200,
        body: JSON.stringify({
          data: parsed.input.map((_value, idx) => ({
            index: idx,
            embedding: [batchOffset + idx, 0, 1]
          }))
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://api.openai.com/v1/embeddings'
      }
    })

    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)
    const vectors = await provider.embed(texts, 'document')

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(
      fetcher.mock.calls.map(
        ([req]) =>
          (JSON.parse(req.body ?? '{}') as { input: string[] }).input.length
      )
    ).toEqual([64, 64, 2])
    expect(vectors).toHaveLength(130)
    expect(vectors[0]).toEqual([0, 0, 1])
    expect(vectors[64]).toEqual([64, 0, 1])
    expect(vectors[129]).toEqual([129, 0, 1])
  })

  it('throws non-retryable EmbeddingProviderError when vector dimensions mismatch', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.openai.com/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)
    const error = await provider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(EmbeddingProviderError)
    expect((error as EmbeddingProviderError).retryable).toBe(false)
    expect((error as EmbeddingProviderError).message).toContain(
      'returned 5 dimensions, expected 3'
    )
  })

  it.each([
    ['invalid JSON', 'not-json'],
    ['mismatched vector count', JSON.stringify({ data: [] })],
    [
      'duplicate indices',
      JSON.stringify({
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 0, embedding: [0.4, 0.5, 0.6] }
        ]
      })
    ],
    [
      'non-numeric vector element',
      JSON.stringify({
        data: [
          { index: 0, embedding: [0.1, null, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] }
        ]
      })
    ]
  ])(
    'throws non-retryable EmbeddingProviderError on malformed response (%s)',
    async (_label, body) => {
      const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
        statusCode: 200,
        body,
        bodyTruncated: false,
        headers: {},
        url: 'https://api.openai.com/v1/embeddings'
      })

      const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)
      const error = await provider
        .embed(['a', 'b'], 'query')
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(EmbeddingProviderError)
      expect((error as EmbeddingProviderError).retryable).toBe(false)
      expect((error as EmbeddingProviderError).cause).toBeUndefined()
      expect('cause' in (error as EmbeddingProviderError)).toBe(false)
    }
  )

  it.each([
    { statusCode: 429, retryable: true },
    { statusCode: 500, retryable: true },
    { statusCode: 502, retryable: true },
    { statusCode: 503, retryable: true },
    { statusCode: 400, retryable: false },
    { statusCode: 401, retryable: false },
    { statusCode: 403, retryable: false },
    { statusCode: 404, retryable: false }
  ])(
    'classifies HTTP $statusCode as retryable=$retryable and never leaks API key',
    async ({ statusCode, retryable }) => {
      const fixtureBody = loadFixture('openaiErrorResponse.json')
      const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
        statusCode,
        body: fixtureBody,
        bodyTruncated: false,
        headers: {},
        url: 'https://api.openai.com/v1/embeddings'
      })

      const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)
      const error = await provider
        .embed(['hello'], 'query')
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(EmbeddingProviderError)
      const providerError = error as EmbeddingProviderError
      expect(providerError.statusCode).toBe(statusCode)
      expect(providerError.retryable).toBe(retryable)
      expect(providerError.message).toContain(String(statusCode))
      expect(providerError.message).not.toContain('sk-secret-fixture-key')
      expect(providerError.cause).toBeUndefined()
      expect('cause' in providerError).toBe(false)
    }
  )

  it('truncates long provider error messages to 200 characters', async () => {
    const longDetail = 'x'.repeat(350)
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 400,
      body: JSON.stringify({ error: { message: longDetail } }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.openai.com/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)
    const error = (await provider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError

    expect(error).toBeInstanceOf(EmbeddingProviderError)
    const detailPart = error.message.split(': ').slice(1).join(': ')
    expect(detailPart).toHaveLength(200)
  })

  it('classifies timeouts and network errors as retryable, redacts API key, and omits cause', async () => {
    const timeoutError = Object.assign(
      new Error('Timeout awaiting response with sk-secret-fixture-key'),
      { name: 'TimeoutError' }
    )
    const fetcher = vi.fn<SafeRemoteFetch>().mockRejectedValue(timeoutError)
    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)

    const error = (await provider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError

    expect(error).toBeInstanceOf(EmbeddingProviderError)
    expect(error.retryable).toBe(true)
    expect(error.statusCode).toBeUndefined()
    expect(error.message).not.toContain('sk-secret-fixture-key')
    expect(error.cause).toBeUndefined()
    expect('cause' in error).toBe(false)
  })

  it('classifies SafeRemoteFetchError as non-retryable and omits cause', async () => {
    const fetcher = vi
      .fn<SafeRemoteFetch>()
      .mockRejectedValue(
        new SafeRemoteFetchError(
          'Unsafe remote address: 10.0.0.1',
          'ERR_UNSAFE_REMOTE_URL'
        )
      )
    const provider = createOpenAIEmbeddingProvider(BASE_CONFIG, fetcher)

    const error = (await provider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError

    expect(error).toBeInstanceOf(EmbeddingProviderError)
    expect(error.retryable).toBe(false)
    expect(error.cause).toBeUndefined()
    expect('cause' in error).toBe(false)
  })

  it('sends no size field when dimensionsField is none', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: recordedMistralResponse([[0.1, 0.2, 0.3]]),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.mistral.ai/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(
      { ...MISTRAL_CONFIG, dimensions: 3 },
      fetcher
    )
    await provider.embed(['hello'], 'document')

    const request = fetcher.mock.calls[0]?.[0]
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      model: 'mistral-embed',
      input: ['hello']
    })
  })

  it('sends output_dimension when dimensionsField is output_dimension', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.mistral.ai/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(
      { ...MISTRAL_CONFIG, dimensions: 3, dimensionsField: 'output_dimension' },
      fetcher
    )
    await provider.embed(['hello'], 'document')

    const request = fetcher.mock.calls[0]?.[0]
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      model: 'mistral-embed',
      input: ['hello'],
      output_dimension: 3
    })
  })

  it('chunks by the configured batch size (20 texts at 8 per request)', async () => {
    const texts = Array.from({ length: 20 }, (_, index) => `text-${index}`)
    let offset = 0
    const fetcher = vi.fn<SafeRemoteFetch>(async ({ body }) => {
      const parsed = JSON.parse(body ?? '{}') as { input: string[] }
      const start = offset
      offset += parsed.input.length
      return {
        statusCode: 200,
        body: JSON.stringify({
          data: parsed.input.map((_value, idx) => ({
            index: idx,
            embedding: [start + idx, 0, 1]
          }))
        }),
        bodyTruncated: false,
        headers: {},
        url: 'https://api.mistral.ai/v1/embeddings'
      }
    })

    const provider = createOpenAIEmbeddingProvider(
      { ...MISTRAL_CONFIG, dimensions: 3 },
      fetcher
    )
    const vectors = await provider.embed(texts, 'document')

    expect(provider.maxBatchSize).toBe(8)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(
      fetcher.mock.calls.map(
        ([req]) =>
          (JSON.parse(req.body ?? '{}') as { input: string[] }).input.length
      )
    ).toEqual([8, 8, 4])
    expect(vectors).toHaveLength(20)
    expect(vectors[0]).toEqual([0, 0, 1])
    expect(vectors[8]).toEqual([8, 0, 1])
    expect(vectors[19]).toEqual([19, 0, 1])
  })

  it('uses the configured timeout and lets a per-call timeout override it', async () => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.openai.com/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(
      { ...BASE_CONFIG, timeoutMs: 5000 },
      fetcher
    )

    await provider.embed(['hello'], 'query')
    expect(fetcher.mock.calls[0]?.[0].timeoutInMilliseconds).toBe(5000)

    await provider.embed(['hello'], 'query', { timeoutMs: 2000 })
    expect(fetcher.mock.calls[1]?.[0].timeoutInMilliseconds).toBe(2000)
  })

  it('parses a recorded Mistral response with 1024-dimension vectors', async () => {
    const vectors = [mistralVector(0), mistralVector(1)]
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 200,
      body: recordedMistralResponse(vectors),
      bodyTruncated: false,
      headers: {},
      url: 'https://api.mistral.ai/v1/embeddings'
    })

    const provider = createOpenAIEmbeddingProvider(MISTRAL_CONFIG, fetcher)
    const result = await provider.embed(
      ['first post', 'second post'],
      'document'
    )

    expect(result).toEqual(vectors)
    expect(provider.cacheKey).toBe(
      'openai:https://api.mistral.ai/v1:mistral-embed:1024'
    )

    const request = fetcher.mock.calls[0]?.[0]
    expect(request?.url).toBe('https://api.mistral.ai/v1/embeddings')
    expect(request?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer mistral-secret-fixture-key'
    })
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      model: 'mistral-embed',
      input: ['first post', 'second post']
    })
  })

  it.each([
    ['https://api.mistral.ai/v1', 'Mistral'],
    ['https://api.openai.com/v1', 'OpenAI'],
    ['https://embeddings.example.com/v1', 'OpenAI-compatible']
  ])('labels errors by endpoint host (%s → %s)', async (endpoint, label) => {
    const fetcher = vi.fn<SafeRemoteFetch>().mockResolvedValue({
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'upstream failed' } }),
      bodyTruncated: false,
      headers: {},
      url: `${endpoint}/embeddings`
    })

    const provider = createOpenAIEmbeddingProvider(
      { ...BASE_CONFIG, endpoint },
      fetcher
    )
    const error = (await provider
      .embed(['hello'], 'query')
      .catch((caught: unknown) => caught)) as EmbeddingProviderError

    expect(error).toBeInstanceOf(EmbeddingProviderError)
    expect(error.message).toContain(
      `${label} embeddings request failed with status 500`
    )
  })
})
