import { ActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { Actor } from '@/lib/types/activitypub'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'

interface MisskeyUserShowResponse {
  id?: string
  followersCount?: number
  followingCount?: number
  notesCount?: number
  followersVisibility?: string
  followingVisibility?: string
}

interface Params {
  person: Actor
  currentCounts: ActorCollectionCounts
}

export const getMisskeyCollectionCounts = async ({
  person,
  currentCounts
}: Params): Promise<ActorCollectionCounts> => {
  let followersCount = currentCounts.followersCount
  let followingCount = currentCounts.followingCount
  let statusesCount = currentCounts.statusesCount

  try {
    const actorUrl = new URL(person.id)
    const match = actorUrl.pathname.match(/^\/users\/([^/]+)/)
    const userId = match ? match[1] : undefined

    const bodyPayload = userId
      ? { userId }
      : { username: person.preferredUsername }

    const response = await request({
      url: `https://${actorUrl.host}/api/users/show`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, */*;q=0.8'
      },
      body: JSON.stringify(bodyPayload)
    })

    if (response.statusCode !== 200 || !response.body) {
      return { followersCount, followingCount, statusesCount }
    }

    const data = JSON.parse(response.body) as MisskeyUserShowResponse

    if (data.followersVisibility === 'private') {
      followersCount = null
    } else if (
      followersCount === null &&
      typeof data.followersCount === 'number' &&
      Number.isFinite(data.followersCount) &&
      data.followersCount >= 0
    ) {
      followersCount = Math.floor(data.followersCount)
    }

    if (data.followingVisibility === 'private') {
      followingCount = null
    } else if (
      followingCount === null &&
      typeof data.followingCount === 'number' &&
      Number.isFinite(data.followingCount) &&
      data.followingCount >= 0
    ) {
      followingCount = Math.floor(data.followingCount)
    }

    if (
      statusesCount === null &&
      typeof data.notesCount === 'number' &&
      Number.isFinite(data.notesCount) &&
      data.notesCount >= 0
    ) {
      statusesCount = Math.floor(data.notesCount)
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch Misskey user collection counts',
      actorId: person.id,
      err: toLoggableError(error)
    })
  }

  return { followersCount, followingCount, statusesCount }
}
