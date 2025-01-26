import { Mastodon } from '@llun/activities.schema'

import { Storage } from '@/lib/database/types'
import { ActorData } from '@/lib/models/actor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getMastodonAccount = async (
  storage: Storage,
  actor: ActorData
) => {
  const [statusesCount, statuses] = await Promise.all([
    storage.getActorStatusesCount({ actorId: actor.id }),
    storage.getActorStatuses({ actorId: actor.id })
  ])

  return Mastodon.Account.parse({
    id: actor.id,
    username: actor.username,
    acct: `${actor.username}@${actor.domain}`,
    display_name: actor.name ?? '',
    locked: false,
    bot: false,
    discoverable: false,
    group: false,
    created_at: getISOTimeUTC(actor.createdAt),
    note: '',
    url: `https://${actor.domain}/@${actor.username}`,
    uri: actor.id,
    avatar: actor.iconUrl ?? '',
    avatar_static: actor.iconUrl ?? '',
    header: actor.headerImageUrl ?? '',
    header_static: actor.headerImageUrl ?? '',

    followers_count: actor.followersCount,
    following_count: actor.followingCount,

    statuses_count: statusesCount,
    last_status_at: statuses[0]?.createdAt
      ? getISOTimeUTC(statuses[0]?.createdAt)
      : null,
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
  })
}
