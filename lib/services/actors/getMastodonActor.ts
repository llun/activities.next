import { ActorData } from '@/lib/models/actor'
import { Storage } from '@/lib/storage/types'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getMastodonActor = async (storage: Storage, actor: ActorData) => {
  const [followersCount, followingCount, statusesCount, statuses] =
    await Promise.all([
      storage.getActorFollowersCount({ actorId: actor.id }),
      storage.getActorFollowingCount({ actorId: actor.id }),
      storage.getActorStatusesCount({ actorId: actor.id }),
      storage.getActorStatuses({ actorId: actor.id })
    ])

  return {
    id: actor.id,
    username: actor.username,
    acct: `${actor.username}@${actor.domain}`,
    display_name: actor.name ?? '',
    locked: false,
    bot: false,
    created_at: getISOTimeUTC(actor.createdAt),
    note: '',
    url: `https://${actor.domain}/@${actor.username}`,
    avatar: actor.iconUrl ?? '',
    avatar_static: actor.iconUrl ?? '',
    header: actor.headerImageUrl ?? '',
    header_static: actor.headerImageUrl ?? '',

    followers_count: followersCount,
    following_count: followingCount,

    statuses_count: statusesCount,
    last_status_at: getISOTimeUTC(statuses[0]?.createdAt) ?? '',
    source: {
      privacy: 'public',
      sensitive: false,
      language: '',
      note: '',
      fields: [],
      follow_requests_count: 0
    },
    emojis: [],
    fields: []
  }
}
