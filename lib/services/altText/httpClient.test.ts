import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { fetchAltTextHttpClient } from './httpClient'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

describe('fetchAltTextHttpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to safeRemoteFetch and returns status and body', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: '{"choices":[{"message":{"content":"A photo of a dog"}}]}',
      bodyTruncated: false,
      headers: {},
      url: 'https://api.openai.com/v1/chat/completions'
    })

    const result = await fetchAltTextHttpClient({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
      body: '{"model":"gpt-4o-mini"}',
      timeoutMs: 30000
    })

    expect(result).toEqual({
      statusCode: 200,
      body: '{"choices":[{"message":{"content":"A photo of a dog"}}]}'
    })
    expect(safeRemoteFetch).toHaveBeenCalledWith({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
      body: '{"model":"gpt-4o-mini"}',
      timeoutInMilliseconds: 30000,
      maxBodyBytes: 1 * 1024 * 1024
    })
  })

  it('wraps safeRemoteFetch errors as AltTextProviderError', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(
      new Error('Connection timed out')
    )

    await expect(
      fetchAltTextHttpClient({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 30000
      })
    ).rejects.toThrow(/Alt text backend request failed: Connection timed out/)
  })
})
