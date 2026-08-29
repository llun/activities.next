import { StatusActivity } from '@/lib/activities/statusAction'
import { PROCESS_FORWARDED_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import type { JobMessage } from '@/lib/services/queue/type'
import {
  CreateAction,
  DeleteAction,
  UpdateAction
} from '@/lib/types/activitypub/activities'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Activity types worth verifying by origin re-fetch when they arrive FORWARDED
// (HTTP signer !== activity actor — AP §7.1.2 inbox forwarding). Mastodon
// forwards Create/Update/Delete of replies in threads; anything else has no
// fetchable authenticity anchor without LD signatures and is dropped, matching
// Mastodon's own handling of non-LD-signed forwards.
const FORWARDABLE_TYPES: string[] = [CreateAction, UpdateAction, DeleteAction]

// Deliberately NO verifiedSenderActorId: the HTTP signer is the forwarder, not
// the author — processForwardedActivityJob derives trust from the origin fetch
// alone. The `#forwarded` dedup suffix keeps this message from suppressing (or
// being suppressed by) a DIRECT delivery of the same activity id, since the
// queue dedups globally on message.id.
export const getForwardedJobMessage = (
  activity: StatusActivity
): JobMessage | null => {
  if (!FORWARDABLE_TYPES.includes(activity.type)) return null
  return {
    id: getHashFromString(`${activity.id}#forwarded`),
    name: PROCESS_FORWARDED_ACTIVITY_JOB_NAME,
    data: activity
  }
}
