import { getActorPosts, getPublicProfileFromHandle } from '@/lib/activities'
import { CACHE_KEY_PREFIX_ACTOR, CACHE_NAMESPACE_ACTORS } from '@/lib/constants'
import { Actor } from '@/lib/models/actor'
import { Storage } from '@/lib/storage/types'
import { cache } from '@/lib/utils/cache'

export async function getActorProfile(storage: Storage, actor: Actor) {
  if (!actor.account) {
    const profile = await getPublicProfileFromHandle(
      actor.getMention(true),
      true
    )
    if (!profile) return null

    return cache(
      CACHE_NAMESPACE_ACTORS,
      `${CACHE_KEY_PREFIX_ACTOR}_${actor.getMention(true)}`,
      async () => {
        const [statuses, attachments] = await Promise.all([
          getActorPosts({ postsUrl: profile.urls?.posts }),
          storage.getAttachmentsForActor({ actorId: profile.id })
        ])
        return {
          person: profile,
          statuses,
          attachments: attachments.map((item) => item.toJson())
        }
      }
    )
  }

  return cache(
    CACHE_NAMESPACE_ACTORS,
    `${CACHE_KEY_PREFIX_ACTOR}_${actor}`,
    async () => {
      const [
        statuses,
        statusCount,
        attachments,
        followingCount,
        followersCount
      ] = await Promise.all([
        storage.getActorStatuses({ actorId: actor.id }),
        storage.getActorStatusesCount({ actorId: actor.id }),
        storage.getAttachmentsForActor({ actorId: actor.id }),
        storage.getActorFollowingCount({ actorId: actor.id }),
        storage.getActorFollowersCount({ actorId: actor.id })
      ])
      return {
        person: actor.toPublicProfile({
          followersCount,
          followingCount,
          totalPosts: statusCount
        }),
        statuses: statuses.map((item) => item.toJson()),
        attachments: attachments.map((item) => item.toJson())
      }
    }
  )
}
