export const QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS = 30_000

export type QueueWorkerShutdownFailureStage = 'runner.stop' | 'database.destroy'

export interface QueueWorkerShutdownFailure {
  stage: QueueWorkerShutdownFailureStage
  error: unknown
}

export interface QueueWorkerShutdownResult {
  succeeded: boolean
  failures: QueueWorkerShutdownFailure[]
}

export interface QueueWorkerShutdownRunner {
  stop: () => Promise<void>
}

export interface QueueWorkerShutdownDatabase {
  destroy: () => Promise<void>
}

export interface CreateQueueWorkerShutdownOptions {
  runner: QueueWorkerShutdownRunner
  database: QueueWorkerShutdownDatabase
  timeoutMs?: number
}

export class QueueWorkerShutdownTimeoutError extends Error {
  constructor() {
    super('Queue worker shutdown deadline exceeded')
    this.name = 'QueueWorkerShutdownTimeoutError'
  }
}

const waitWithinDeadline = async (
  operation: () => Promise<void>,
  deadline: number
): Promise<void> => {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    throw new QueueWorkerShutdownTimeoutError()
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new QueueWorkerShutdownTimeoutError())
        }, remainingMs)
      })
    ])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

const shutdownQueueWorker = async ({
  runner,
  database,
  timeoutMs = QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS
}: CreateQueueWorkerShutdownOptions): Promise<QueueWorkerShutdownResult> => {
  const deadline = Date.now() + timeoutMs
  const failures: QueueWorkerShutdownFailure[] = []

  try {
    await waitWithinDeadline(() => runner.stop(), deadline)
  } catch (error) {
    failures.push({ stage: 'runner.stop', error })
  }

  if (Date.now() >= deadline) {
    if (failures.length === 0) {
      failures.push({
        stage: 'database.destroy',
        error: new QueueWorkerShutdownTimeoutError()
      })
    }

    return {
      succeeded: false,
      failures
    }
  }

  try {
    await waitWithinDeadline(() => database.destroy(), deadline)
  } catch (error) {
    failures.push({ stage: 'database.destroy', error })
  }

  return {
    succeeded: failures.length === 0,
    failures
  }
}

export const createQueueWorkerShutdown = ({
  runner,
  database,
  timeoutMs = QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS
}: CreateQueueWorkerShutdownOptions): (() => Promise<QueueWorkerShutdownResult>) => {
  let shutdownPromise: Promise<QueueWorkerShutdownResult> | undefined

  return () => {
    shutdownPromise ??= shutdownQueueWorker({ runner, database, timeoutMs })
    return shutdownPromise
  }
}
