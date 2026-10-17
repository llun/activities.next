import {
  SafeRemoteFetchError,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

import {
  PROFILE_LINK_MAX_BODY_BYTES,
  PROFILE_LINK_MAX_REDIRECTS,
  verifyProfileLink
} from './verifyProfileLink'

vi.mock('@/lib/utils/safeRemoteFetch', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/utils/safeRemoteFetch')
  >('@/lib/utils/safeRemoteFetch')
  return { ...actual, safeRemoteFetch: vi.fn() }
})

const mockedFetch = vi.mocked(safeRemoteFetch)
const PROFILE = 'https://llun.test/@anna'
const LINK_BACKS = [PROFILE, 'https://llun.test/users/anna']
const PAGE = `<html><body><a rel="me" href="${PROFILE}">me</a></body></html>`

const response = (
  body: string,
  overrides: { statusCode?: number; contentType?: string } = {}
) => ({
  body,
  bodyTruncated: false,
  headers: {
    'content-type': overrides.contentType ?? 'text/html; charset=utf-8'
  },
  statusCode: overrides.statusCode ?? 200,
  url: 'https://blog.example/'
})

const verify = () =>
  verifyProfileLink({ url: 'https://blog.example/', linkBacks: LINK_BACKS })

describe('verifyProfileLink', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('verifies a page that links back with rel="me"', async () => {
    mockedFetch.mockResolvedValue(response(PAGE))

    await expect(verify()).resolves.toBe(true)
  })

  it('fetches through safeRemoteFetch with a body cap that fails and bounded redirects', async () => {
    mockedFetch.mockResolvedValue(response(PAGE))

    await verify()

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://blog.example/',
        maxBodyBytes: PROFILE_LINK_MAX_BODY_BYTES,
        maxRedirects: PROFILE_LINK_MAX_REDIRECTS,
        onBodyTooLarge: 'fail'
      })
    )
  })

  it('accepts application/xhtml+xml', async () => {
    mockedFetch.mockResolvedValue(
      response(PAGE, { contentType: 'application/xhtml+xml' })
    )

    await expect(verify()).resolves.toBe(true)
  })

  it('does not verify a page without the link back', async () => {
    mockedFetch.mockResolvedValue(response('<html><body>hi</body></html>'))

    await expect(verify()).resolves.toBe(false)
  })

  it('does not verify a non-HTML response', async () => {
    mockedFetch.mockResolvedValue(
      response(PAGE, { contentType: 'application/json' })
    )

    await expect(verify()).resolves.toBe(false)
  })

  it('does not verify a response without a content type', async () => {
    mockedFetch.mockResolvedValue({
      ...response(PAGE),
      headers: {}
    })

    await expect(verify()).resolves.toBe(false)
  })

  it('does not verify a non-200 response', async () => {
    mockedFetch.mockResolvedValue(response(PAGE, { statusCode: 404 }))

    await expect(verify()).resolves.toBe(false)
  })

  it('does not verify when the body is over the cap', async () => {
    mockedFetch.mockRejectedValue(
      new SafeRemoteFetchError(
        'Response body too large',
        'ERR_RESPONSE_TOO_LARGE'
      )
    )

    await expect(verify()).resolves.toBe(false)
  })

  it('does not verify when the SSRF guard refuses the address', async () => {
    mockedFetch.mockRejectedValue(
      new SafeRemoteFetchError(
        'Unsafe remote address: 10.0.0.1',
        'ERR_UNSAFE_REMOTE_URL'
      )
    )

    await expect(verify()).resolves.toBe(false)
  })

  it('does not verify when the request fails', async () => {
    mockedFetch.mockRejectedValue(new Error('socket hang up'))

    await expect(verify()).resolves.toBe(false)
  })
})
