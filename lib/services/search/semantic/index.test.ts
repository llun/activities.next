import { getConfig } from '@/lib/config'
import {
  SafeRemoteFetch,
  createSafeRemoteFetch,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const mockPrivateFetcher = vi.fn<SafeRemoteFetch>()

vi.mock('@/lib/utils/safeRemoteFetch', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/utils/safeRemoteFetch')
  >('@/lib/utils/safeRemoteFetch')
  return {
    ...actual,
    safeRemoteFetch: vi.fn(),
    createSafeRemoteFetch: vi.fn(() => mockPrivateFetcher)
  }
})

describe('getEmbeddingProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns null when searchEmbeddings is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      searchEmbeddings: undefined
    } as ReturnType<typeof getConfig>)

    const { getEmbeddingProvider } = await import('./index')
    expect(getEmbeddingProvider()).toBeNull()
    expect(createSafeRemoteFetch).not.toHaveBeenCalled()
  })

  it('uses default safeRemoteFetch when allowPrivateEndpoint is false and memoizes the provider', async () => {
    vi.mocked(getConfig).mockReturnValue({
      searchEmbeddings: {
        provider: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'gemini-embedding-001',
        dimensions: 2,
        batchSize: 100,
        timeoutMs: 30_000,
        allowPrivateEndpoint: false
      }
    } as ReturnType<typeof getConfig>)

    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }] }),
      bodyTruncated: false,
      headers: {},
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
    })

    const { getEmbeddingProvider } = await import('./index')
    const first = getEmbeddingProvider()
    const second = getEmbeddingProvider()

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(first?.cacheKey).toBe('gemini:gemini-embedding-001:2')
    expect(createSafeRemoteFetch).not.toHaveBeenCalled()

    await expect(first?.embed(['hi'], 'query')).resolves.toEqual([[0.1, 0.2]])
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    expect(mockPrivateFetcher).not.toHaveBeenCalled()
  })

  it('creates a private-network fetcher only when allowPrivateEndpoint is true', async () => {
    vi.mocked(getConfig).mockReturnValue({
      searchEmbeddings: {
        provider: 'openai',
        endpoint: 'http://192.168.1.20:11434/v1',
        model: 'nomic-embed-text',
        dimensions: 2,
        dimensionsField: 'none',
        batchSize: 32,
        timeoutMs: 30_000,
        allowPrivateEndpoint: true
      }
    } as ReturnType<typeof getConfig>)

    mockPrivateFetcher.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ data: [{ index: 0, embedding: [0.3, 0.4] }] }),
      bodyTruncated: false,
      headers: {},
      url: 'http://192.168.1.20:11434/v1/embeddings'
    })

    const { getEmbeddingProvider } = await import('./index')
    const provider = getEmbeddingProvider()

    expect(provider?.cacheKey).toBe(
      'openai:http://192.168.1.20:11434/v1:nomic-embed-text:2'
    )
    expect(createSafeRemoteFetch).toHaveBeenCalledTimes(1)
    expect(createSafeRemoteFetch).toHaveBeenCalledWith({
      allowPrivateNetwork: true
    })

    await expect(provider?.embed(['hi'], 'document')).resolves.toEqual([
      [0.3, 0.4]
    ])
    expect(mockPrivateFetcher).toHaveBeenCalledTimes(1)
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })
})
