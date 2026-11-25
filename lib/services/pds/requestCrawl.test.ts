import type { BlueskyPdsConfig } from '@/lib/config/blueskyPds'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  PDS_REQUEST_CRAWL_INITIAL_RETRY_MS,
  PDS_REQUEST_CRAWL_MAX_DURATION_MS,
  PDS_REQUEST_CRAWL_TIMEOUT_MS,
  requestPdsCrawl,
  startPdsCrawlRequests
} from './requestCrawl'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const okResponse = (url: string, statusCode = 200) => ({
  body: '',
  bodyTruncated: false,
  headers: {},
  statusCode,
  url
})

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('PDS requestCrawl', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('POSTs JSON { hostname } to each HTTPS relay through safeRemoteFetch and rejects non-HTTPS URLs', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      okResponse('https://bsky.network/xrpc/com.atproto.sync.requestCrawl')
    )

    const results = await requestPdsCrawl({
      hostname: 'pds.example.com',
      relays: ['https://bsky.network/', 'http://insecure.example.com']
    })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    expect(safeRemoteFetch).toHaveBeenCalledWith({
      url: 'https://bsky.network/xrpc/com.atproto.sync.requestCrawl',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: 'pds.example.com' }),
      timeoutInMilliseconds: PDS_REQUEST_CRAWL_TIMEOUT_MS,
      allowCrossHostRedirects: false
    })

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      relay: 'https://bsky.network',
      ok: true,
      statusCode: 200
    })
    expect(results[1].ok).toBe(false)
  })

  it('requests crawl only for enabled domains and retries with exponential backoff until success', async () => {
    const { logger } = await import('@/lib/utils/logger')
    const config: BlueskyPdsConfig = {
      'enabled.example': {
        domain: 'enabled.example',
        enabled: true,
        hostname: 'pds.enabled.example',
        did: 'did:web:pds.enabled.example',
        allowEmails: [],
        allowActors: [],
        relays: ['https://bsky.network']
      },
      'disabled.example': {
        domain: 'disabled.example',
        enabled: false,
        hostname: 'pds.disabled.example',
        did: 'did:web:pds.disabled.example',
        allowEmails: [],
        allowActors: [],
        relays: ['https://bsky.network']
      },
      'norelay.example': {
        domain: 'norelay.example',
        enabled: true,
        hostname: 'pds.norelay.example',
        did: 'did:web:pds.norelay.example',
        allowEmails: [],
        allowActors: [],
        relays: []
      }
    }

    vi.mocked(safeRemoteFetch)
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(
        okResponse(
          'https://bsky.network/xrpc/com.atproto.sync.requestCrawl',
          503
        )
      )
      .mockResolvedValueOnce(
        okResponse(
          'https://bsky.network/xrpc/com.atproto.sync.requestCrawl',
          200
        )
      )

    const stop = startPdsCrawlRequests(config)
    await flushMicrotasks()

    // Attempt 1 failed immediately with network error.
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'enabled.example',
        relay: 'https://bsky.network',
        err: expect.any(Error)
      }),
      expect.any(String)
    )

    // Backoff 1: 30s.
    await vi.advanceTimersByTimeAsync(PDS_REQUEST_CRAWL_INITIAL_RETRY_MS - 1)
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()
    expect(safeRemoteFetch).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledTimes(2)

    // Backoff 2: 60s -> succeeds on attempt 3.
    await vi.advanceTimersByTimeAsync(59_999)
    expect(safeRemoteFetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()
    expect(safeRemoteFetch).toHaveBeenCalledTimes(3)
    expect(logger.error).toHaveBeenCalledTimes(2)

    // No further attempts after success.
    await vi.advanceTimersByTimeAsync(PDS_REQUEST_CRAWL_MAX_DURATION_MS)
    expect(safeRemoteFetch).toHaveBeenCalledTimes(3)

    stop()
  })

  it('caps backoff at 10 minutes and stops retrying after 1 hour', async () => {
    const config: BlueskyPdsConfig = {
      'example.com': {
        domain: 'example.com',
        enabled: true,
        hostname: 'pds.example.com',
        did: 'did:web:pds.example.com',
        allowEmails: [],
        allowActors: [],
        relays: ['https://bsky.network']
      }
    }

    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('relay down'))

    const stop = startPdsCrawlRequests(config)
    await flushMicrotasks()

    // Expected retry times (s): 0, 30, 90, 210, 450, 930, 1530, 2130, 2730, 3330 (10 attempts total).
    // Next retry would be at 3930s > 3600s, so retrying stops.
    await vi.advanceTimersByTimeAsync(PDS_REQUEST_CRAWL_MAX_DURATION_MS * 2)
    await flushMicrotasks()

    expect(safeRemoteFetch).toHaveBeenCalledTimes(10)
    stop()
  })

  it('cancels pending retries and aborts in-flight requests when stop() is called', async () => {
    const config: BlueskyPdsConfig = {
      'example.com': {
        domain: 'example.com',
        enabled: true,
        hostname: 'pds.example.com',
        did: 'did:web:pds.example.com',
        allowEmails: [],
        allowActors: [],
        relays: ['https://bsky.network']
      }
    }

    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('temporary failure'))

    const stop = startPdsCrawlRequests(config)
    await flushMicrotasks()
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)

    stop()
    await vi.advanceTimersByTimeAsync(PDS_REQUEST_CRAWL_MAX_DURATION_MS)
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
  })
})
