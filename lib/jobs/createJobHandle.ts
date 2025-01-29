import { JobHandle } from '../services/queue/type'
import { getTracer } from '../utils/trace'

export const createJobHandle = (
  jobName: string,
  handle: JobHandle
): JobHandle => {
  return async (database, message) => {
    await getTracer().startActiveSpan(jobName, async (span) => {
      try {
        await handle(database, message)
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
