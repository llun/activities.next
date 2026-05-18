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
import { getVisibility } from '@/lib/utils/getVisibility'

const PUBLIC_AUDIENCES = new Set([
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
])

const isFollowersAudience = (actorId: string) => actorId.endsWith('/followers')

export const isDirectAudienceActorId = (actorId: string) =>
  !PUBLIC_AUDIENCES.has(actorId) && !isFollowersAudience(actorId)

export const isDirectStatus = (
  status: Status
): status is StatusNote | StatusPoll =>
  status.type !== StatusType.enum.Announce &&
  getVisibility(status.to, status.cc) === 'direct'

export const getDirectStatusParticipantActorIds = (status: Status) =>
  [...new Set([status.actorId, ...status.to, ...status.cc])].filter(
    isDirectAudienceActorId
  )
