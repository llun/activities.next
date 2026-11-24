import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { blueskyFetch } from './fetch'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))

describe('blueskyFetch', () => {
  beforeEach(() => {
    vi.mocked(safeRemoteFetch).mockReset()
  })

  it('sends the request through safeRemoteFetch and builds a Response', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      body: '{"ok":true}',
      bodyTruncated: false,
      headers: { 'content-type': 'application/json', 'set-cookie': ['a', 'b'] },
      statusCode: 201,
      url: 'https://pds.example.net/token'
    })

    const response = await blueskyFetch('https://pds.example.net/token', {
      method: 'POST',
      headers: { DPoP: 'proof' },
      body: new URLSearchParams({ grant_type: 'refresh_token' }),
      redirect: 'error'
    })

    expect(safeRemoteFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://pds.example.net/token',
        method: 'POST',
        bodyBytes: new TextEncoder().encode('grant_type=refresh_token'),
        headers: expect.objectContaining({ dpop: 'proof' }),
        maxRedirects: 0,
        allowCrossHostRedirects: false
      })
    )
    expect(vi.mocked(safeRemoteFetch).mock.calls[0][0]).not.toHaveProperty(
      'body'
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('set-cookie')).toBe('a, b')
  })

  it('sends a binary body byte-for-byte', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      body: '{"blob":{}}',
      bodyTruncated: false,
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
      url: 'https://pds.example.net/xrpc/com.atproto.repo.uploadBlob'
    })
    // Bytes that are not valid UTF-8: `request.text()` would replace them.
    const bytes = new Uint8Array([0xff, 0x00, 0xfe, 0x80, 0x41])

    await blueskyFetch(
      'https://pds.example.net/xrpc/com.atproto.repo.uploadBlob',
      {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: bytes
      }
    )

    const sent = vi.mocked(safeRemoteFetch).mock.calls[0][0]
    expect(sent).not.toHaveProperty('body')
    expect(Array.from(sent.bodyBytes ?? [])).toEqual(Array.from(bytes))
  })

  it('follows same-host redirects only when the caller allows them', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      body: '',
      bodyTruncated: false,
      headers: {},
      statusCode: 204,
      url: 'https://example.com/'
    })

    const response = await blueskyFetch('https://example.com/')

    expect(safeRemoteFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        maxRedirects: undefined,
        allowCrossHostRedirects: false
      })
    )
    expect(vi.mocked(safeRemoteFetch).mock.calls[0][0]).not.toHaveProperty(
      'body'
    )
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it('passes refusals through as errors', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('private address'))
    await expect(blueskyFetch('https://10.0.0.1/')).rejects.toThrow(
      'private address'
    )
  })
})
