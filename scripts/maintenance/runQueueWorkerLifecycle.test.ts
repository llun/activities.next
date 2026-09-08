import { createDeferred } from '@/lib/testing/deferred'

import {
  QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS,
  QueueWorkerShutdownTimeoutError,
  createQueueWorkerShutdown
} from './runQueueWorkerLifecycle'

describe('createQueueWorkerShutdown', () => {
  it('stops the runner before destroying the database', async () => {
    const events: string[] = []
    const runner = {
      stop: vi.fn(async () => {
        events.push('runner.stop')
      })
    }
    const database = {
      destroy: vi.fn(async () => {
        events.push('database.destroy')
      })
    }

    const result = await createQueueWorkerShutdown({
      runner,
      database
    })()

    expect(result).toEqual({ succeeded: true, failures: [] })
    expect(events).toEqual(['runner.stop', 'database.destroy'])
  })

  it('coalesces repeated signals into one shutdown operation', async () => {
    const stopDeferred = createDeferred<void>()
    const runner = { stop: vi.fn(() => stopDeferred.promise) }
    const database = { destroy: vi.fn(async () => undefined) }
    const shutdown = createQueueWorkerShutdown({ runner, database })

    const first = shutdown()
    const second = shutdown()

    expect(second).toBe(first)
    await Promise.resolve()
    expect(runner.stop).toHaveBeenCalledTimes(1)
    expect(database.destroy).not.toHaveBeenCalled()

    stopDeferred.resolve(undefined)
    await first
    expect(database.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the database when runner stop rejects and reports failure', async () => {
    const stopError = new Error('runner stop failed')
    const runner = {
      stop: vi.fn(async () => {
        throw stopError
      })
    }
    const database = { destroy: vi.fn(async () => undefined) }

    const result = await createQueueWorkerShutdown({
      runner,
      database
    })()

    expect(result.succeeded).toBe(false)
    expect(result.failures).toEqual([
      { stage: 'runner.stop', error: stopError }
    ])
    expect(database.destroy).toHaveBeenCalledTimes(1)
  })

  it('reports database destruction failure after a successful drain', async () => {
    const destroyError = new Error('database destroy failed')
    const runner = { stop: vi.fn(async () => undefined) }
    const database = {
      destroy: vi.fn(async () => {
        throw destroyError
      })
    }

    const result = await createQueueWorkerShutdown({
      runner,
      database
    })()

    expect(result.succeeded).toBe(false)
    expect(result.failures).toEqual([
      { stage: 'database.destroy', error: destroyError }
    ])
  })

  it('fails when runner stop hangs until the shared deadline', async () => {
    vi.useFakeTimers()
    try {
      const runner = { stop: vi.fn(() => createDeferred<void>().promise) }
      const database = { destroy: vi.fn(async () => undefined) }
      const shutdown = createQueueWorkerShutdown({
        runner,
        database,
        timeoutMs: 20
      })

      const resultPromise = shutdown()
      await vi.advanceTimersByTimeAsync(20)
      const result = await resultPromise

      expect(result.succeeded).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]?.stage).toBe('runner.stop')
      expect(result.failures[0]?.error).toBeInstanceOf(
        QueueWorkerShutdownTimeoutError
      )
      expect(database.destroy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails when database destruction hangs until the shared deadline', async () => {
    vi.useFakeTimers()
    try {
      const destroyDeferred = createDeferred<void>()
      const runner = { stop: vi.fn(async () => undefined) }
      const database = {
        destroy: vi.fn(() => destroyDeferred.promise)
      }
      const shutdown = createQueueWorkerShutdown({
        runner,
        database,
        timeoutMs: 20
      })

      const resultPromise = shutdown()
      await vi.advanceTimersByTimeAsync(20)
      const result = await resultPromise

      expect(result.succeeded).toBe(false)
      expect(result.failures[0]?.stage).toBe('database.destroy')
      expect(result.failures[0]?.error).toBeInstanceOf(
        QueueWorkerShutdownTimeoutError
      )
      expect(runner.stop).toHaveBeenCalledTimes(1)
      expect(database.destroy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the remaining shared deadline for database destruction', async () => {
    vi.useFakeTimers()
    try {
      const destroyDeferred = createDeferred<void>()
      const runner = {
        stop: vi.fn(
          () => new Promise<void>((resolve) => setTimeout(resolve, 15))
        )
      }
      const database = {
        destroy: vi.fn(() => destroyDeferred.promise)
      }
      const shutdown = createQueueWorkerShutdown({
        runner,
        database,
        timeoutMs: 20
      })

      const resultPromise = shutdown()
      let settled = false
      void resultPromise.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(15)
      expect(database.destroy).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(4)
      await Promise.resolve()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const result = await resultPromise

      expect(result.succeeded).toBe(false)
      expect(result.failures[0]?.stage).toBe('database.destroy')
      expect(result.failures[0]?.error).toBeInstanceOf(
        QueueWorkerShutdownTimeoutError
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the documented 30 second default deadline', () => {
    expect(QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS).toBe(30_000)
  })
})
