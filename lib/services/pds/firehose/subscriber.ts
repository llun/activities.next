import type { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { encodeErrorFrame, encodeEventFrame, encodeInfoFrame } from './frames'
import type { PdsEventSource } from './source'

export const PDS_FIREHOSE_PAGE_SIZE = 100
export const PDS_FIREHOSE_PAGE_MAX_BYTES = 2 * 1024 * 1024
export const PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES = 1024 * 1024
export const PDS_FIREHOSE_MAX_BUFFERED_BYTES = 8 * 1024 * 1024
export const PDS_FIREHOSE_DRAIN_TIMEOUT_MS = 60_000

export type PdsFirehoseDatabase = Pick<
  Database,
  'getPdsEventSeqBounds' | 'listPdsEvents'
>

export interface PdsFirehoseTransport {
  send(frame: Uint8Array): void
  bufferedAmount(): number
  waitForDrain?(): Promise<void>
  close(code?: number, reason?: string): void
}

export interface PdsFirehoseSubscriberOptions {
  database: PdsFirehoseDatabase
  domain: string
  cursor?: number
  source: PdsEventSource
  transport: PdsFirehoseTransport
  pageSize?: number
  pageMaxBytes?: number
  lowWaterBufferedBytes?: number
  maxBufferedBytes?: number
  drainTimeoutMs?: number
}

export interface PdsFirehoseSubscriber {
  start(): Promise<void>
  stop(): void
}

export const createPdsFirehoseSubscriber = ({
  database,
  domain,
  cursor,
  source,
  transport,
  pageSize = PDS_FIREHOSE_PAGE_SIZE,
  pageMaxBytes = PDS_FIREHOSE_PAGE_MAX_BYTES,
  lowWaterBufferedBytes = PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES,
  maxBufferedBytes = PDS_FIREHOSE_MAX_BUFFERED_BYTES,
  drainTimeoutMs = PDS_FIREHOSE_DRAIN_TIMEOUT_MS
}: PdsFirehoseSubscriberOptions): PdsFirehoseSubscriber => {
  let started = false
  let stopped = false
  let initialized = false
  let pumping = false
  let dirty = false
  let lastSeq = 0
  let unsubscribe: (() => void) | null = null
  let cancelDrainWait: (() => void) | null = null

  const stop = (): void => {
    if (stopped) return
    stopped = true
    const cancelDrain = cancelDrainWait
    cancelDrainWait = null
    cancelDrain?.()
    const unsub = unsubscribe
    unsubscribe = null
    unsub?.()
  }

  const closeConsumerTooSlow = (): void => {
    stop()
    try {
      transport.send(
        encodeErrorFrame(
          'ConsumerTooSlow',
          'Consumer could not keep up with event stream'
        )
      )
    } catch {
      // Ignore send errors when the transport is already closing.
    }
    transport.close(1000, 'ConsumerTooSlow')
  }

  const checkBackpressure = (): boolean => {
    if (transport.bufferedAmount() <= maxBufferedBytes) {
      return false
    }
    closeConsumerTooSlow()
    return true
  }

  const waitForDrainWithTimeout = (
    drainPromise: Promise<void>
  ): Promise<boolean> =>
    new Promise<boolean>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        if (cancelDrainWait === cancel) {
          cancelDrainWait = null
        }
      }
      const finish = (timedOut: boolean): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(timedOut)
      }
      const cancel = (): void => {
        finish(false)
      }
      const timer = setTimeout(() => {
        finish(true)
      }, drainTimeoutMs)
      timer.unref?.()
      cancelDrainWait = cancel

      drainPromise.then(
        () => finish(false),
        (error: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
      )
    })

  const waitForBackpressure = async (): Promise<boolean> => {
    if (stopped) return true
    if (checkBackpressure()) return true
    if (
      transport.waitForDrain &&
      transport.bufferedAmount() > lowWaterBufferedBytes
    ) {
      const timedOut = await waitForDrainWithTimeout(transport.waitForDrain())
      if (stopped) return true
      if (checkBackpressure()) return true
      if (timedOut && transport.bufferedAmount() > lowWaterBufferedBytes) {
        closeConsumerTooSlow()
        return true
      }
    }
    return stopped
  }

  const pump = async (): Promise<void> => {
    if (stopped || !initialized) return
    if (pumping) {
      dirty = true
      return
    }
    pumping = true

    try {
      while (!stopped) {
        dirty = false
        const prevLastSeq = lastSeq
        const { newest: newestReadBefore } =
          await database.getPdsEventSeqBounds()
        if (stopped) return

        const events = await database.listPdsEvents({
          afterSeq: lastSeq,
          limit: pageSize,
          maxBytes: pageMaxBytes,
          domain,
          activeReposOnly: true
        })
        if (stopped) return

        if (events.length === 0) {
          // Safe to advance past skipped events (other domains or inactive
          // repos) up to the newest seq observed before the query: the
          // PostgreSQL advisory lock in `appendPdsEvent` makes commit order
          // equal seq order, and SQLite has a single writer, so no event with
          // seq <= newestReadBefore can become visible after this read.
          if (newestReadBefore !== null) {
            lastSeq = Math.max(lastSeq, newestReadBefore)
          }
        } else {
          for (const event of events) {
            if (await waitForBackpressure()) return
            transport.send(encodeEventFrame(event))
            lastSeq = event.seq
            if (checkBackpressure()) return
          }
        }

        if (events.length > 0 && lastSeq > prevLastSeq) {
          continue
        }

        if (dirty) {
          continue
        }

        break
      }
    } catch (error) {
      if (!stopped) {
        logger.error({
          message: 'Failed to stream PDS firehose events',
          err: toLoggableError(error),
          domain,
          lastSeq
        })
        stop()
        transport.close(1011, 'Internal server error')
      }
    } finally {
      pumping = false
      if (dirty && !stopped && initialized) {
        void pump()
      }
    }
  }

  const start = async (): Promise<void> => {
    if (started || stopped) return
    started = true

    unsubscribe = source.subscribe(() => {
      if (stopped) return
      dirty = true
      if (initialized) {
        void pump()
      }
    })

    let bounds: { oldest: number | null; newest: number | null }
    try {
      bounds = await database.getPdsEventSeqBounds()
    } catch (error) {
      if (!stopped) {
        logger.error({
          message: 'Failed to read PDS firehose sequence bounds',
          err: toLoggableError(error),
          domain
        })
        stop()
        transport.close(1011, 'Internal server error')
      }
      return
    }

    if (stopped) return

    const { oldest, newest } = bounds

    if (cursor === undefined) {
      lastSeq = newest ?? 0
      initialized = true
      if (dirty) {
        await pump()
      }
      return
    }

    if (newest === null) {
      if (cursor > 0) {
        stop()
        transport.send(
          encodeErrorFrame('FutureCursor', 'Cursor is in the future')
        )
        transport.close(1000, 'FutureCursor')
        return
      }
      lastSeq = 0
      initialized = true
      await pump()
      return
    }

    if (cursor > newest) {
      stop()
      transport.send(
        encodeErrorFrame('FutureCursor', 'Cursor is in the future')
      )
      transport.close(1000, 'FutureCursor')
      return
    }

    if (oldest !== null && cursor < oldest - 1) {
      if (await waitForBackpressure()) return
      transport.send(
        encodeInfoFrame(
          'OutdatedCursor',
          'Requested cursor is older than the retained event log'
        )
      )
      if (checkBackpressure()) return
      lastSeq = oldest - 1
    } else {
      lastSeq = Math.max(0, cursor)
    }

    initialized = true
    await pump()
  }

  return { start, stop }
}
