import { fetchTranslationHttpClient } from './httpClient'

const originalFetch = global.fetch

describe('fetchTranslationHttpClient', () => {
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns the status code and streamed body', async () => {
    global.fetch = jest
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
    global.fetch = jest.fn().mockResolvedValue(
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
    global.fetch = jest
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

  it('wraps transport errors as TranslationProviderError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))

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
