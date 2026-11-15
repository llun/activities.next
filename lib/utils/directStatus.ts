import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getStatusVisibility } from '@/lib/utils/getVisibility'

const PUBLIC_AUDIENCES = new Set([
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
])

// A followers collection is either the author's stored followers URL — servers
// do not agree on its path (Friendica's is `/followers/<nick>`) — or, for an
// actor whose settings lack one, anything ending in `/followers`.
const isFollowersAudience = (actorId: string, followersUrl?: string | null) =>
  (followersUrl ? actorId === followersUrl : false) ||
  actorId.endsWith('/followers')

export const isDirectAudienceActorId = (
  actorId: string,
  followersUrl?: string | null
) =>
  !PUBLIC_AUDIENCES.has(actorId) && !isFollowersAudience(actorId, followersUrl)

export const isDirectStatus = (
  status: Status
): status is StatusNote | StatusPoll =>
  status.type !== StatusType.enum.Announce &&
  getStatusVisibility(status) === 'direct'

export const getDirectStatusParticipantActorIds = (status: Status) => {
  const followersUrl = status.actor?.followersUrl
  return [...new Set([status.actorId, ...status.to, ...status.cc])].filter(
    (actorId) => isDirectAudienceActorId(actorId, followersUrl)
  )
}
