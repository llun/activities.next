import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'

// For an inbox: an inbound job's failure must reach the route, so the sender's
// delivery is retried. NoQueue's `publish` logs an undecidable-policy error
// from an inline job instead (right for a user request whose work committed,
// wrong here: the inbox would answer 202 for an activity it never processed),
// so an inline queue runs the handler directly. Inbound jobs carry no delay.
export const publishInbound = (message: JobMessage) => {
  const queue = getQueue()
  return queue.runsInline ? queue.handle(message) : queue.publish(message)
}
