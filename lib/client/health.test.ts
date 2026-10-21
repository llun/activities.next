import { checkServerHealth } from '@/lib/client/health'

describe('checkServerHealth', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /health without the HTTP cache and resolves true on 2xx', async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"UP"}'))
    const controller = new AbortController()

    await expect(
      checkServerHealth({ signal: controller.signal })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/health', {
      cache: 'no-store',
      signal: controller.signal
    })
  })

  it('resolves false on a non-ok response', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))

    await expect(checkServerHealth()).resolves.toBe(false)
  })

  it('lets a network error propagate', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(checkServerHealth()).rejects.toBeInstanceOf(TypeError)
  })
})
