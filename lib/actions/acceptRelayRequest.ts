import { Database } from '@/lib/database/types'
import { RelayData } from '@/lib/types/database/operations'

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
// relay, or null when no subscription matches the Accept.
export const acceptRelayRequest = async ({
  activity,
  database
}: RelayHandshakeParams): Promise<RelayData | null> => {
  const relay = await resolveRelay(database, activity)
  if (!relay) return null
  return database.updateRelay({
    id: relay.id,
    state: 'accepted',
    actorId: activity.actor,
    lastError: null
  })
}

// Marks the matching relay subscription rejected. Returns the updated relay, or
// null when no subscription matches the Reject.
export const rejectRelayRequest = async ({
  activity,
  database
}: RelayHandshakeParams): Promise<RelayData | null> => {
  const relay = await resolveRelay(database, activity)
  if (!relay) return null
  return database.updateRelay({
    id: relay.id,
    state: 'rejected',
    lastError: 'Relay rejected the subscription request'
  })
}
