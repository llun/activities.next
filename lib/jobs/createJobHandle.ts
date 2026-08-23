import { JobHandle } from '@/lib/services/queue/type'
import { withSpan } from '@/lib/utils/trace'

export const createJobHandle = (
  jobName: string,
  handle: JobHandle
): JobHandle => {
  return async (database, message) => {
    return withSpan('job', jobName, {}, async () => {
      await handle(database, message)
    })
  }
}
