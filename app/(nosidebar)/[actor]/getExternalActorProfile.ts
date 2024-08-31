import { getActorPosts, getPublicProfileFromHandle } from '@/lib/activities'
import { Storage } from '@/lib/storage/types'

export const getExternalActorProfile = async (
  storage: Storage,
  actorHandle: string
) => {
  const profile = await getPublicProfileFromHandle(actorHandle, true)
  if (!profile) return null

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
