import { JobHandle } from '../services/queue/type'
import { getTracer } from '../utils/trace'

export const createJobHandle = (
  jobName: string,
  handle: JobHandle
): JobHandle => {
  return async (storage, message) => {
    await getTracer().startActiveSpan(jobName, async (span) => {
      try {
        await handle(storage, message)
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        throw error
      } finally {
        span.end()
      }
    })
  }
}
