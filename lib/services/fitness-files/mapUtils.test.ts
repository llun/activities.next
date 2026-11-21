import { StreamByteLimitError } from '@/lib/utils/streamLimit'

import { fetchOsmTile } from './mapUtils'

describe('fetchOsmTile', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  // A tile server that accepts the connection and then stalls must not hold
  // the request open forever, so every tile fetch carries a deadline.
  it('passes an abort signal to the tile request', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' }
      })
    ) as unknown as typeof fetch

    await fetchOsmTile(1, 0, 0)

    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  // A tile is a few tens of kilobytes; a body over the cap is refused rather
  // than buffered, so a hostile or broken tile server cannot exhaust memory.
  it('refuses a tile body over the byte cap', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-type': 'image/png',
          'content-length': String(2 * 1024 * 1024)
        }
      })
    ) as unknown as typeof fetch

    await expect(fetchOsmTile(1, 0, 0)).rejects.toBeInstanceOf(
      StreamByteLimitError
    )
  })
})
