import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'

// For a caller whose next step depends on the job having run: an inbox (whose
// failure must reach the sender as a 5xx so the delivery is retried) or a step
// that records success after publishing (a move marked started or queued).
// NoQueue's `publish` logs an undecidable-policy error from an inline job
// instead (right for a user request whose own work committed), so an inline
// queue runs the handler directly. These jobs carry no delay.
export const publishSurfacingErrors = (message: JobMessage) => {
  const queue = getQueue()
  return queue.runsInline ? queue.handle(message) : queue.publish(message)
}
