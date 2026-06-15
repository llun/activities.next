import { fetchTranslationHttpClient } from './httpClient'

const originalFetch = global.fetch

describe('fetchTranslationHttpClient', () => {
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns the status code and streamed body', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    const result = await fetchTranslationHttpClient({
      url: 'https://api.example/translate',
      method: 'POST',
      headers: {},
      body: '{}',
      timeoutMs: 1000
    })

    expect(result).toEqual({ statusCode: 200, body: '{"ok":true}' })
  })

  it('rejects when content-length exceeds the cap before reading the body', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('small', {
        status: 200,
        headers: { 'content-length': String(8 * 1024 * 1024) }
      })
    )

    await expect(
      fetchTranslationHttpClient({
        url: 'https://api.example/translate',
        method: 'POST',
        headers: {},
        timeoutMs: 1000
      })
    ).rejects.toThrow(/too large/)
  })

  it('rejects when the streamed body exceeds the cap', async () => {
    // 1.5 MB body with no content-length header, so the cap must be enforced
    // while streaming rather than from the declared length.
    const big = 'a'.repeat(1.5 * 1024 * 1024)
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(big, { status: 200 }))

    await expect(
      fetchTranslationHttpClient({
        url: 'https://api.example/translate',
        method: 'GET',
        headers: {},
        timeoutMs: 1000
      })
    ).rejects.toThrow(/too large/)
  })

  it('caps on UTF-8 byte length, not UTF-16 code units, in the buffered path', async () => {
    // 600k '€' chars: 600k code units (under the 1 MB cap) but 1.8 MB of UTF-8
    // bytes (over it). A code-unit check would wrongly accept this.
    const multibyte = '€'.repeat(600 * 1024)
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(multibyte, { status: 200 }))

    await expect(
      fetchTranslationHttpClient({
        url: 'https://api.example/translate',
        method: 'GET',
        headers: {},
        timeoutMs: 1000
      })
    ).rejects.toThrow(/too large/)
  })

  it('wraps transport errors as TranslationProviderError', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      fetchTranslationHttpClient({
        url: 'https://api.example/translate',
        method: 'GET',
        headers: {},
        timeoutMs: 1000
      })
    ).rejects.toThrow(/request failed/)
  })
})
