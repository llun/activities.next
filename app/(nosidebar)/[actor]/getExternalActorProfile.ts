import { getActorPosts, getPublicProfileFromHandle } from '@/lib/activities'
import { Database } from '@/lib/database/types'

export const getExternalActorProfile = async (
  database: Database,
  actorHandle: string
) => {
  const profile = await getPublicProfileFromHandle(actorHandle, true)
  if (!profile) return null

  const [actorPostsResponse, attachments] = await Promise.all([
    getActorPosts({ postsUrl: profile.urls?.posts }),
    database.getAttachmentsForActor({ actorId: profile.id })
  ])
  return {
    person: profile,
    statuses: actorPostsResponse,
    attachments: attachments.map((item) => item.toJson())
  }
}
