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
import {
  getStatusVisibility,
  getTrustedFollowersUrl,
  isFollowersCollection
} from '@/lib/utils/getVisibility'

const PUBLIC_AUDIENCES = new Set([
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
])

export const isDirectAudienceActorId = (
  actorId: string,
  followersUrl?: string | null
) =>
  !PUBLIC_AUDIENCES.has(actorId) &&
  !isFollowersCollection(actorId, followersUrl)

export const isDirectStatus = (
  status: Status
): status is StatusNote | StatusPoll =>
  status.type !== StatusType.enum.Announce &&
  getStatusVisibility(status) === 'direct'

export const getDirectStatusParticipantActorIds = (status: Status) => {
  const followersUrl = getTrustedFollowersUrl(
    status.actorId,
    status.actor?.followersUrl
  )
  return [...new Set([status.actorId, ...status.to, ...status.cc])].filter(
    (actorId) => isDirectAudienceActorId(actorId, followersUrl)
  )
}
