import { CACHE_KEY_PREFIX_ACTOR, CACHE_NAMESPACE_ACTORS } from '@/lib/constants'
import { Actor } from '@/lib/models/actor'
import { Storage } from '@/lib/storage/types'
import { cache } from '@/lib/utils/cache'

export const getInternalActorProfile = async (storage: Storage, actor: Actor) =>
  cache(
    CACHE_NAMESPACE_ACTORS,
    `${CACHE_KEY_PREFIX_ACTOR}_${actor}`,
    async () => {
      const [statuses, attachments] = await Promise.all([
        storage.getActorStatuses({ actorId: actor.id }),
        storage.getAttachmentsForActor({ actorId: actor.id })
      ])
      return {
        person: actor.toPublicProfile(),
        statuses: statuses.map((item) => item.toJson()),
        attachments: attachments.map((item) => item.toJson())
      }
    }
  )
