import { JobHandle } from '../services/queue/type'
import { getTracer } from '../utils/trace'

export const createJobHandle = (
  jobName: string,
  handle: JobHandle
): JobHandle => {
  return async (storage, message) => {
    await getTracer().startActiveSpan(
      'queue.handle',
      { attributes: { job: jobName } },
      async (span) => {
        await handle(storage, message)
        span.end()
      }
    )
  }
}
