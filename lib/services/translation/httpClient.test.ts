import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { fetchTranslationHttpClient } from './httpClient'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

describe('fetchTranslationHttpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to safeRemoteFetch and returns status and body', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: '{"translations":["Hola"]}',
      bodyTruncated: false,
      headers: {},
      url: 'https://api.deepl.com/v2/translate'
    })

    const result = await fetchTranslationHttpClient({
      url: 'https://api.deepl.com/v2/translate',
      method: 'POST',
      headers: { Authorization: 'DeepL-Auth-Key test' },
      body: '{"text":"Hello"}',
      timeoutMs: 10000
    })

    expect(result).toEqual({
      statusCode: 200,
      body: '{"translations":["Hola"]}'
    })
    expect(safeRemoteFetch).toHaveBeenCalledWith({
      url: 'https://api.deepl.com/v2/translate',
      method: 'POST',
      headers: { Authorization: 'DeepL-Auth-Key test' },
      body: '{"text":"Hello"}',
      timeoutInMilliseconds: 10000,
      maxBodyBytes: 1 * 1024 * 1024
    })
  })

  it('wraps safeRemoteFetch errors as TranslationProviderError', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('Connection reset'))

    await expect(
      fetchTranslationHttpClient({
        url: 'https://api.deepl.com/v2/translate',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 10000
      })
    ).rejects.toThrow(/Translation backend request failed: Connection reset/)
  })
})
