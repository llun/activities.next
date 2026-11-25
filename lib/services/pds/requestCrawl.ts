import {
  type BlueskyPdsConfig,
  normalizePdsRelayUrl
} from '@/lib/config/blueskyPds'
import { logger } from '@/lib/utils/logger'
import {
  type SafeRemoteFetch,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const PDS_REQUEST_CRAWL_TIMEOUT_MS = 15_000
export const PDS_REQUEST_CRAWL_INITIAL_RETRY_MS = 30_000
export const PDS_REQUEST_CRAWL_MAX_RETRY_MS = 10 * 60 * 1000
export const PDS_REQUEST_CRAWL_MAX_DURATION_MS = 60 * 60 * 1000

const REQUEST_CRAWL_PATH = '/xrpc/com.atproto.sync.requestCrawl'

export type PdsCrawlRequestResult =
  | {
      relay: string
      ok: true
      statusCode: number
    }
  | {
      relay: string
      ok: false
      statusCode?: number
      error: Error
    }

export type RequestPdsCrawlOptions = {
  hostname: string
  relays: readonly string[]
  signal?: AbortSignal
  timeoutMs?: number
  fetch?: SafeRemoteFetch
}

const requestSingleRelayCrawl = async ({
  hostname,
  relay,
  signal,
  timeoutMs,
  fetch
}: {
  hostname: string
  relay: string
  signal?: AbortSignal
  timeoutMs: number
  fetch: SafeRemoteFetch
}): Promise<PdsCrawlRequestResult> => {
  const normalizedRelay = normalizePdsRelayUrl(relay)
  if (!normalizedRelay) {
    return {
      relay,
      ok: false,
      error: new Error(`Invalid HTTPS relay URL: ${relay}`)
    }
  }

  try {
    const response = await fetch({
      url: `${normalizedRelay}${REQUEST_CRAWL_PATH}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ hostname }),
      timeoutInMilliseconds: timeoutMs,
      allowCrossHostRedirects: false,
      ...(signal ? { signal } : {})
    })

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {
        relay: normalizedRelay,
        ok: true,
        statusCode: response.statusCode
      }
    }

    return {
      relay: normalizedRelay,
      ok: false,
      statusCode: response.statusCode,
      error: new Error(
        `Relay ${normalizedRelay} rejected requestCrawl with HTTP ${response.statusCode}`
      )
    }
  } catch (error) {
    return {
      relay: normalizedRelay,
      ok: false,
      error: toLoggableError(error)
    }
  }
}

/**
 * Calls `com.atproto.sync.requestCrawl` on each HTTPS relay in `relays` for
 * `hostname`, routed through `safeRemoteFetch`.
 */
export const requestPdsCrawl = async ({
  hostname,
  relays,
  signal,
  timeoutMs = PDS_REQUEST_CRAWL_TIMEOUT_MS,
  fetch = safeRemoteFetch
}: RequestPdsCrawlOptions): Promise<PdsCrawlRequestResult[]> =>
  Promise.all(
    relays.map((relay) =>
      requestSingleRelayCrawl({
        hostname,
        relay,
        signal,
        timeoutMs,
        fetch
      })
    )
  )

export type StartPdsCrawlRequestsOptions = {
  timeoutMs?: number
  initialRetryMs?: number
  maxRetryMs?: number
  maxDurationMs?: number
  fetch?: SafeRemoteFetch
}

/**
 * Asks every configured relay to crawl each enabled PDS domain at start-up,
 * retrying failures per (domain, relay) with exponential backoff until one
 * attempt succeeds or `maxDurationMs` (default 1 hour) elapses. Returns a stop
 * function that aborts in-flight requests and cancels pending retries.
 */
export const startPdsCrawlRequests = (
  config: BlueskyPdsConfig | null,
  {
    timeoutMs = PDS_REQUEST_CRAWL_TIMEOUT_MS,
    initialRetryMs = PDS_REQUEST_CRAWL_INITIAL_RETRY_MS,
    maxRetryMs = PDS_REQUEST_CRAWL_MAX_RETRY_MS,
    maxDurationMs = PDS_REQUEST_CRAWL_MAX_DURATION_MS,
    fetch = safeRemoteFetch
  }: StartPdsCrawlRequestsOptions = {}
): (() => void) => {
  if (!config) return () => {}

  const abortController = new AbortController()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let stopped = false

  const startRelayTask = (
    domain: string,
    hostname: string,
    relay: string
  ): void => {
    const startedAt = Date.now()
    let delayMs = initialRetryMs

    const runAttempt = async (): Promise<void> => {
      if (stopped) return

      const [result] = await requestPdsCrawl({
        hostname,
        relays: [relay],
        signal: abortController.signal,
        timeoutMs,
        fetch
      })

      if (stopped || !result) return

      if (result.ok) {
        logger.info(
          {
            domain,
            hostname,
            relay: result.relay,
            statusCode: result.statusCode
          },
          'Requested Bluesky relay crawl'
        )
        return
      }

      logger.error(
        {
          domain,
          hostname,
          relay: result.relay,
          ...(result.statusCode !== undefined
            ? { statusCode: result.statusCode }
            : {}),
          err: toLoggableError(result.error)
        },
        'Failed to request Bluesky relay crawl'
      )

      const elapsedMs = Date.now() - startedAt
      if (elapsedMs + delayMs > maxDurationMs) {
        return
      }

      const waitMs = delayMs
      delayMs = Math.min(delayMs * 2, maxRetryMs)

      const timer = setTimeout(() => {
        timers.delete(timer)
        void runAttempt()
      }, waitMs)
      timer.unref?.()
      timers.add(timer)
    }

    void runAttempt()
  }

  for (const entry of Object.values(config)) {
    if (!entry.enabled) continue
    for (const relay of entry.relays) {
      startRelayTask(entry.domain, entry.hostname, relay)
    }
  }

  return () => {
    if (stopped) return
    stopped = true
    for (const timer of timers) {
      clearTimeout(timer)
    }
    timers.clear()
    abortController.abort()
  }
}
