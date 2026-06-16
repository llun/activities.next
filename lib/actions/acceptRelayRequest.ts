import { Database } from '@/lib/database/types'
import { RelayData } from '@/lib/types/database/operations'
import { normalizeActorId } from '@/lib/utils/activitypub'

// A relay confirms (Accept) or declines (Reject) the Follow we sent. The
// activity is delivered to the instance/federation signing actor's inbox and
// is HTTP-signature verified as the relay before reaching here. `object` is the
// Follow we sent — relays echo it either as the full object or as a bare id
// string, so accept both shapes.
interface RelayHandshakeActivity {
  actor: string
  object: string | { id?: string }
}

interface RelayHandshakeParams {
  activity: RelayHandshakeActivity
  database: Database
}

const getFollowActivityId = (
  object: string | { id?: string }
): string | null => {
  if (typeof object === 'string') return object
  return object?.id ?? null
}

const resolveRelay = async (
  database: Database,
  activity: RelayHandshakeActivity
): Promise<RelayData | null> => {
  const followActivityId = getFollowActivityId(activity.object)
  if (!followActivityId) return null
  return database.getRelayByFollowActivityId({ followActivityId })
}

// Marks the matching relay subscription accepted and records the relay's actor
// id (so subsequently forwarded activities are recognised). Returns the updated
// relay, or null when no PENDING subscription matches the Accept.
//
// Only a `pending` relay may be accepted. This makes an admin's unsubscribe
// durable: a delayed, duplicate, or maliciously re-sent Accept cannot resurrect
// an idle, rejected, or already-accepted relay. The actor id is normalized to
// the same canonical form the inbound signature guard produces, so the relay is
// reliably matched when its forwarded activities arrive.
export const acceptRelayRequest = async ({
  activity,
  database
}: RelayHandshakeParams): Promise<RelayData | null> => {
  const relay = await resolveRelay(database, activity)
  if (!relay || relay.state !== 'pending') return null
  const actorId = normalizeActorId(activity.actor)
  if (!actorId) return null
  return database.updateRelay({
    id: relay.id,
    state: 'accepted',
    actorId,
    lastError: null
  })
}

// Marks the matching pending relay subscription rejected. Returns the updated
// relay, or null when no pending subscription matches the Reject.
export const rejectRelayRequest = async ({
  activity,
  database
}: RelayHandshakeParams): Promise<RelayData | null> => {
  const relay = await resolveRelay(database, activity)
  if (!relay || relay.state !== 'pending') return null
  return database.updateRelay({
    id: relay.id,
    state: 'rejected',
    lastError: 'Relay rejected the subscription request'
  })
}
