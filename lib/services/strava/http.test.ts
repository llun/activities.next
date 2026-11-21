import { StreamByteLimitError } from '@/lib/utils/streamLimit'

import {
  STRAVA_MAX_RESPONSE_BYTES,
  readStravaBody,
  readStravaJson,
  stravaFetch
} from './http'

describe('stravaFetch', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  // A stalled Strava connection must not hold the request open forever.
  it('passes an abort signal to the request', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}')) as unknown as typeof fetch

    await stravaFetch('https://www.strava.com/api/v3/athlete')

    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps a caller-supplied signal', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}')) as unknown as typeof fetch
    const controller = new AbortController()

    await stravaFetch('https://www.strava.com/api/v3/athlete', {
      signal: controller.signal
    })

    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })
})

describe('readStravaBody', () => {
  // Strava's JSON payloads are small; a body over the cap is refused rather
  // than buffered, so a broken or hostile response cannot exhaust memory.
  it('refuses a body over the byte cap', async () => {
    const response = new Response('{}', {
      headers: { 'content-length': String(STRAVA_MAX_RESPONSE_BYTES + 1) }
    })

    await expect(
      readStravaBody(response, 'Strava response')
    ).rejects.toBeInstanceOf(StreamByteLimitError)
  })

  it('parses a JSON body within the cap', async () => {
    const response = new Response(JSON.stringify({ id: 42 }))

    await expect(
      readStravaJson<{ id: number }>(response, 'Strava')
    ).resolves.toEqual({ id: 42 })
  })
})
