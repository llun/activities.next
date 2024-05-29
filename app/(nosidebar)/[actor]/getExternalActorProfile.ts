import { getActorPosts, getPublicProfileFromHandle } from '@/lib/activities'
import { CACHE_KEY_PREFIX_ACTOR, CACHE_NAMESPACE_ACTORS } from '@/lib/constants'
import { Storage } from '@/lib/storage/types'
import { cache } from '@/lib/utils/cache'

export const getExternalActorProfile = async (
  storage: Storage,
  actorHandle: string
) => {
  const profile = await getPublicProfileFromHandle(actorHandle, true)
  if (!profile) return null

  return cache(
    CACHE_NAMESPACE_ACTORS,
    `${CACHE_KEY_PREFIX_ACTOR}_${actorHandle}`,
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
