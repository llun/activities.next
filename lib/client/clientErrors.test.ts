/**
 * @vitest-environment jsdom
 */
import {
  CLIENT_ERRORS_PATH,
  CLIENT_ERROR_MAX_LENGTHS
} from '@/lib/utils/clientErrors/types'

const readBlob = (blob: Blob): Promise<string> => blob.text()

describe('reportClientError', () => {
  const originalBeacon = navigator.sendBeacon
  const originalFetch = globalThis.fetch
  const originalEnv = process.env.NEXT_PUBLIC_BUILD_VERSION

  let reportClientError: typeof import('./clientErrors').reportClientError

  beforeEach(async () => {
    vi.resetModules()
    ;({ reportClientError } = await import('./clientErrors'))
    process.env.NEXT_PUBLIC_BUILD_VERSION = '2.4.0'
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: originalBeacon
    })
    globalThis.fetch = originalFetch
    process.env.NEXT_PUBLIC_BUILD_VERSION = originalEnv
  })

  const setBeacon = (value: unknown) =>
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value
    })

  it('sends the payload as a JSON blob through a beacon', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    const fetchMock = vi.fn()
    setBeacon(beacon)
    globalThis.fetch = fetchMock

    const err = new Error('Test crash')
    err.stack = 'Error: Test crash\n    at test.js:1:1'
    ;(err as Error & { digest?: string }).digest = 'digest-abc'

    reportClientError(err, 'error')

    expect(beacon).toHaveBeenCalledTimes(1)
    const [url, blob] = beacon.mock.calls[0]
    expect(url).toBe(CLIENT_ERRORS_PATH)
    expect(blob.type).toBe('application/json')

    const sent = JSON.parse(await readBlob(blob))
    expect(sent).toEqual({
      name: 'Error',
      message: 'Test crash',
      stack: 'Error: Test crash\n    at test.js:1:1',
      digest: 'digest-abc',
      pathname: window.location.pathname,
      userAgent: navigator.userAgent,
      buildVersion: '2.4.0',
      source: 'error'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to keepalive fetch when beacon returns false', () => {
    setBeacon(vi.fn().mockReturnValue(false))
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    globalThis.fetch = fetchMock

    const err = new Error('Fetch fallback test')
    reportClientError(err, 'global-error')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(CLIENT_ERRORS_PATH)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.keepalive).toBe(true)
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })

    const parsed = JSON.parse(init.body as string)
    expect(parsed.message).toBe('Fetch fallback test')
    expect(parsed.source).toBe('global-error')
  })

  it('falls back to fetch when beacon is not supported', () => {
    setBeacon(undefined)
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    globalThis.fetch = fetchMock

    reportClientError(new Error('No beacon test'), 'chunk-load')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates reports per page load across sources', () => {
    const beacon = vi.fn().mockReturnValue(true)
    setBeacon(beacon)

    const error1 = new Error('Duplicate test')
    ;(error1 as Error & { digest?: string }).digest = 'd-1'

    const error2 = new Error('Duplicate test')
    ;(error2 as Error & { digest?: string }).digest = 'd-1'

    reportClientError(error1, 'error')
    // Second call with same name|message|digest, even with different source
    reportClientError(error2, 'global-error')

    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('stops sending after 10 reports in a single page load', () => {
    const beacon = vi.fn().mockReturnValue(true)
    setBeacon(beacon)

    for (let i = 0; i < 15; i++) {
      reportClientError(new Error(`Unique error ${i}`), 'error')
    }

    expect(beacon).toHaveBeenCalledTimes(10)
  })

  it('truncates oversized message, stack, and digest to their caps', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    setBeacon(beacon)

    const bigErr = new Error('m'.repeat(CLIENT_ERROR_MAX_LENGTHS.message + 200))
    bigErr.stack = 's'.repeat(CLIENT_ERROR_MAX_LENGTHS.stack + 500)
    ;(bigErr as Error & { digest?: string }).digest = 'd'.repeat(
      CLIENT_ERROR_MAX_LENGTHS.digest + 50
    )

    reportClientError(bigErr, 'error')

    expect(beacon).toHaveBeenCalledTimes(1)
    const [, blob] = beacon.mock.calls[0]
    const sent = JSON.parse(await readBlob(blob))

    expect(sent.message.length).toBe(CLIENT_ERROR_MAX_LENGTHS.message)
    expect(sent.stack.length).toBe(CLIENT_ERROR_MAX_LENGTHS.stack)
    expect(sent.digest.length).toBe(CLIENT_ERROR_MAX_LENGTHS.digest)
  })

  it('never throws when beacon and fetch both throw', () => {
    setBeacon(
      vi.fn(() => {
        throw new Error('Beacon exploded')
      })
    )
    globalThis.fetch = vi.fn(() => {
      throw new Error('Fetch exploded')
    })

    expect(() => {
      reportClientError(new Error('Kaboom'), 'error')
    }).not.toThrow()
  })

  it('never serialises a thrown object without a string message', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    setBeacon(beacon)
    const toJSON = vi.fn(() => ({ password: 'private-secret' }))
    const thrown: Record<string, unknown> = {
      message: 42,
      password: 'private-secret',
      toJSON
    }
    thrown.circular = thrown

    reportClientError(thrown, 'error')

    expect(toJSON).not.toHaveBeenCalled()
    expect(beacon).toHaveBeenCalledTimes(1)
    const body = await readBlob(beacon.mock.calls[0][1])
    expect(JSON.parse(body).message).toBe('Non-Error object thrown')
    expect(body).not.toContain('private-secret')
  })

  it('preserves a string message on a thrown object', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    setBeacon(beacon)
    reportClientError({ message: 'Object message' }, 'error')
    expect(JSON.parse(await readBlob(beacon.mock.calls[0][1])).message).toBe(
      'Object message'
    )
  })

  it('handles non-Error objects and strings safely', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    setBeacon(beacon)

    reportClientError('Raw string error', 'error')
    expect(beacon).toHaveBeenCalledTimes(1)
    const [, blob1] = beacon.mock.calls[0]
    expect(JSON.parse(await readBlob(blob1)).message).toBe('Raw string error')

    reportClientError({ custom: 'object-failure' }, 'error')
    expect(beacon).toHaveBeenCalledTimes(2)
    const [, blob2] = beacon.mock.calls[1]
    expect(JSON.parse(await readBlob(blob2)).message).toBe(
      'Non-Error object thrown'
    )
  })
})
