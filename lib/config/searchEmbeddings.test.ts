import { logger } from '@/lib/utils/logger'

import {
  DEFAULT_GEMINI_EMBEDDINGS_ENDPOINT,
  DEFAULT_GEMINI_EMBEDDINGS_MODEL,
  DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS,
  DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
  GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE,
  MAX_SEARCH_EMBEDDINGS_BATCH_SIZE,
  MAX_SEARCH_EMBEDDINGS_TIMEOUT_MS,
  MIN_SEARCH_EMBEDDINGS_BATCH_SIZE,
  MIN_SEARCH_EMBEDDINGS_TIMEOUT_MS,
  getSearchEmbeddingsConfig,
  readSearchEmbeddingsDimensions
} from './searchEmbeddings'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn()
  }
}))

const firstWarnMessage = () =>
  (
    vi.mocked(logger.warn).mock.calls[0]?.[0] as
      { message?: string } | undefined
  )?.message ?? ''

describe('getSearchEmbeddingsConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ACTIVITIES_SEARCH_EMBEDDINGS_')) {
        delete process.env[key]
      }
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns null with no warning when no semantic search env vars are set', () => {
    expect(getSearchEmbeddingsConfig()).toBeNull()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('defaults to the openai provider and warns once when endpoint and model are missing', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = '768'

    expect(getSearchEmbeddingsConfig()).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith({
      message: expect.stringMatching(
        /ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER=openai requires .*ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT.*ACTIVITIES_SEARCH_EMBEDDINGS_MODEL.*semantic search will be disabled/
      )
    })
  })

  it('builds an openai config when the provider is unset', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'https://api.openai.com/v1'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        dimensions: DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS,
        dimensionsField: 'dimensions',
        batchSize: 64,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: false
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns once and returns null for an unknown provider', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'cohere'

    expect(getSearchEmbeddingsConfig()).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith({
      message: expect.stringMatching(
        /ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER.*semantic search will be disabled/
      )
    })
  })

  it('builds Gemini config with defaults for endpoint, model, dimensions, batch size and timeout', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'gemini'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'gemini-test-key'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'gemini',
        endpoint: DEFAULT_GEMINI_EMBEDDINGS_ENDPOINT,
        apiKey: 'gemini-test-key',
        model: DEFAULT_GEMINI_EMBEDDINGS_MODEL,
        dimensions: DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS,
        batchSize: GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: false
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('builds Gemini config with custom endpoint (trailing slash stripped), model and dimensions', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'gemini'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'gemini-test-key'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'https://proxy.example.com/v1beta/'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'gemini-embedding-2-exp'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = '1536'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'gemini',
        endpoint: 'https://proxy.example.com/v1beta',
        apiKey: 'gemini-test-key',
        model: 'gemini-embedding-2-exp',
        dimensions: 1536,
        batchSize: GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: false
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns once and returns null when Gemini API key is missing', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'gemini'

    expect(getSearchEmbeddingsConfig()).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith({
      message: expect.stringMatching(
        /ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY.*semantic search will be disabled/
      )
    })
  })

  it('builds OpenAI config with public HTTPS endpoint and optional API key', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'openai'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'https://api.openai.com/v1/'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'sk-test-key'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = '1024'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key',
        model: 'text-embedding-3-small',
        dimensions: 1024,
        dimensionsField: 'dimensions',
        batchSize: 64,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: false
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('defaults Mistral to no size field and a batch of 8', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'https://api.mistral.ai/v1'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'mistral-embed'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = '1024'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'mistral-test-key'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'openai',
        endpoint: 'https://api.mistral.ai/v1',
        apiKey: 'mistral-test-key',
        model: 'mistral-embed',
        dimensions: 1024,
        dimensionsField: 'none',
        batchSize: 8,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: false
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('defaults any other OpenAI-compatible host to no size field and a batch of 32', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'https://embeddings.example.com/v1'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'custom-embed'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'openai',
        endpoint: 'https://embeddings.example.com/v1',
        model: 'custom-embed',
        dimensions: DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS,
        dimensionsField: 'none',
        batchSize: 32,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: false
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('builds OpenAI config without API key for a local HTTP server when private flag is true', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'openai'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'http://192.168.1.20:11434/v1/'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'nomic-embed-text'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ALLOW_PRIVATE_ENDPOINT = 'true'

    expect(getSearchEmbeddingsConfig()).toEqual({
      searchEmbeddings: {
        provider: 'openai',
        endpoint: 'http://192.168.1.20:11434/v1',
        model: 'nomic-embed-text',
        dimensions: 768,
        dimensionsField: 'none',
        batchSize: 32,
        timeoutMs: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS,
        allowPrivateEndpoint: true
      }
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['endpoint', 'ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT'],
    ['model', 'ACTIVITIES_SEARCH_EMBEDDINGS_MODEL']
  ])(
    'warns once and returns null when OpenAI %s is missing',
    (_label, missingKey) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'openai'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://api.openai.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
      delete process.env[missingKey]

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith({
        message: expect.stringMatching(
          new RegExp(`${missingKey}.*semantic search will be disabled`)
        )
      })
    }
  )

  it.each(['0', '-1', '4001', '768.5', 'abc', '768px', '1e3'])(
    'warns once and returns null when dimensions is invalid (%s)',
    (badDimensions) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'gemini'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'secret-never-logged'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = badDimensions

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const message = firstWarnMessage()
      expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS')
      expect(message).toContain('semantic search will be disabled')
      expect(message).not.toContain('secret-never-logged')
    }
  )

  it.each(['1', '4000'])('accepts boundary dimensions %s', (dims) => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'gemini'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'gemini-test-key'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = dims

    expect(getSearchEmbeddingsConfig()?.searchEmbeddings.dimensions).toBe(
      Number(dims)
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['not a URL', 'not-a-url'],
    ['non-http(s) scheme', 'ftp://example.com/v1'],
    ['URL with credentials', 'https://user:super-secret@api.openai.com/v1']
  ])(
    'warns once and returns null when endpoint is invalid (%s)',
    (_label, badEndpoint) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'openai'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT = badEndpoint
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'sk-never-logged'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'nomic-embed-text'

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const message = firstWarnMessage()
      expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT')
      expect(message).toContain('semantic search will be disabled')
      expect(message).not.toContain('sk-never-logged')
      expect(message).not.toContain('super-secret')
    }
  )

  it.each([undefined, 'false', '1', 'yes'])(
    'rejects HTTP endpoint when allow-private flag is %s',
    (flagValue) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'openai'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'http://192.168.1.20:11434/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'nomic-embed-text'
      if (flagValue !== undefined) {
        process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ALLOW_PRIVATE_ENDPOINT =
          flagValue
      }

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const message = firstWarnMessage()
      expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT')
      expect(message).toContain(
        'ACTIVITIES_SEARCH_EMBEDDINGS_ALLOW_PRIVATE_ENDPOINT'
      )
      expect(message).toContain('semantic search will be disabled')
    }
  )

  it.each(['dimensions', 'output_dimension', 'none'] as const)(
    'accepts dimensions field %s',
    (field) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://api.openai.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS_FIELD = field

      expect(getSearchEmbeddingsConfig()?.searchEmbeddings).toMatchObject({
        dimensionsField: field
      })
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  it.each(['dimension', 'output-dimension', 'DIMENSIONS'])(
    'warns once and returns null when the dimensions field is invalid (%s)',
    (field) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://api.openai.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS_FIELD = field

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const message = firstWarnMessage()
      expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS_FIELD')
      expect(message).toContain('semantic search will be disabled')
    }
  )

  it.each(['0', '-1', '257', '8.5', 'abc', '8px'])(
    'warns once and returns null when the batch size is invalid (%s)',
    (batchSize) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://api.openai.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE = batchSize

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const message = firstWarnMessage()
      expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE')
      expect(message).toContain('semantic search will be disabled')
    }
  )

  it.each([MIN_SEARCH_EMBEDDINGS_BATCH_SIZE, MAX_SEARCH_EMBEDDINGS_BATCH_SIZE])(
    'accepts boundary batch size %s for an OpenAI-compatible endpoint',
    (size) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://embeddings.example.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'custom-embed'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE = String(size)

      expect(getSearchEmbeddingsConfig()?.searchEmbeddings.batchSize).toBe(size)
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  it('caps the Gemini batch size at 100', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER = 'gemini'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY = 'gemini-test-key'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE = '100'

    expect(getSearchEmbeddingsConfig()?.searchEmbeddings.batchSize).toBe(100)
    expect(logger.warn).not.toHaveBeenCalled()

    vi.clearAllMocks()
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE = '101'

    expect(getSearchEmbeddingsConfig()).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const message = firstWarnMessage()
    expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE')
    expect(message).toContain('between 1 and 100')
    expect(message).toContain('semantic search will be disabled')
  })

  it.each(['999', '120001', '30000.5', 'abc', '30s'])(
    'warns once and returns null when the timeout is invalid (%s)',
    (timeout) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://api.openai.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_TIMEOUT_MS = timeout

      expect(getSearchEmbeddingsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const message = firstWarnMessage()
      expect(message).toContain('ACTIVITIES_SEARCH_EMBEDDINGS_TIMEOUT_MS')
      expect(message).toContain('semantic search will be disabled')
    }
  )

  it.each([MIN_SEARCH_EMBEDDINGS_TIMEOUT_MS, MAX_SEARCH_EMBEDDINGS_TIMEOUT_MS])(
    'accepts boundary timeout %s',
    (timeout) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
        'https://api.openai.com/v1'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'text-embedding-3-small'
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_TIMEOUT_MS = String(timeout)

      expect(getSearchEmbeddingsConfig()?.searchEmbeddings.timeoutMs).toBe(
        timeout
      )
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  it('lets explicit batch size and timeout override the host defaults', () => {
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT =
      'https://api.mistral.ai/v1'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL = 'mistral-embed'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE = '16'
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_TIMEOUT_MS = '5000'

    expect(getSearchEmbeddingsConfig()?.searchEmbeddings).toMatchObject({
      batchSize: 16,
      timeoutMs: 5000
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('readSearchEmbeddingsDimensions', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ACTIVITIES_SEARCH_EMBEDDINGS_')) {
        delete process.env[key]
      }
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('reads the dimensions without a provider configured, defaulting to 768', () => {
    expect(readSearchEmbeddingsDimensions()).toEqual({
      dimensions: DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS
    })
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = '1536'
    expect(readSearchEmbeddingsDimensions()).toEqual({ dimensions: 1536 })
  })

  it.each(['0', '4001', '12.5', 'abc'])(
    'answers an error for an invalid value %s instead of the default',
    (value) => {
      process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS = value
      expect(readSearchEmbeddingsDimensions()).toEqual({
        error: expect.stringContaining(value)
      })
    }
  )
})
