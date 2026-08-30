import { fetchAltTextHttpClient } from './httpClient'

const originalFetch = global.fetch

describe('fetchAltTextHttpClient', () => {
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns the status code and streamed body', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    const result = await fetchAltTextHttpClient({
      url: 'https://api.example/alt-text',
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
      fetchAltTextHttpClient({
        url: 'https://api.example/alt-text',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 1000
      })
    ).rejects.toThrow(/too large/)
  })

  it('rejects when the streamed body exceeds the cap', async () => {
    const big = 'a'.repeat(1.5 * 1024 * 1024)
    global.fetch = vi.fn().mockResolvedValue(new Response(big, { status: 200 }))

    await expect(
      fetchAltTextHttpClient({
        url: 'https://api.example/alt-text',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 1000
      })
    ).rejects.toThrow(/too large/)
  })

  it('caps on UTF-8 byte length, not UTF-16 code units, in the buffered path', async () => {
    const multibyte = '€'.repeat(600 * 1024)
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(multibyte, { status: 200 }))

    await expect(
      fetchAltTextHttpClient({
        url: 'https://api.example/alt-text',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 1000
      })
    ).rejects.toThrow(/too large/)
  })

  it('wraps transport errors as AltTextProviderError', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      fetchAltTextHttpClient({
        url: 'https://api.example/alt-text',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 1000
      })
    ).rejects.toThrow(/request failed/)
  })

  it('wraps fetch timeout errors as AltTextProviderError', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('The operation was aborted due to timeout'))

    await expect(
      fetchAltTextHttpClient({
        url: 'https://api.example/alt-text',
        method: 'POST',
        headers: {},
        body: '{}',
        timeoutMs: 1000
      })
    ).rejects.toThrow(/request failed/)
  })
})
