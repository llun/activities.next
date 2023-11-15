import { NextRequest } from 'next/server'

import { ERROR_500 } from '../../../../../lib/errors'
import { headerHost } from '../../../../../lib/guard'
import { getStorage } from '../../../../../lib/storage'

type Query = { params: { username: string } }

export const GET = async (req: NextRequest, query: Query) => {
  const storage = await getStorage()
  if (!storage) {
    return Response.json(ERROR_500, { status: 500 })
  }

  const { username } = query.params
  const host = headerHost(req.headers)
  const id = `https://${host}/users/${username}`
  const followerId = `${id}/followers`

  const totalItems = await storage.getActorFollowersCount({ actorId: id })
  return Response.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followerId,
    type: 'OrderedCollection',
    totalItems
  })
}
