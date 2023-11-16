import { ERROR_404, ERROR_500 } from '../../../../../lib/errors'
import { headerHost } from '../../../../../lib/guard'
import { getStorage } from '../../../../../lib/storage'
import { OnlyLocalUserGuard } from '../guard'

export const GET = OnlyLocalUserGuard(async (req, query) => {
  const storage = await getStorage()
  if (!storage) {
    return Response.json(ERROR_500, { status: 500 })
  }

  if (!query?.params) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const { username } = query.params
  const host = headerHost(req.headers)
  const id = `https://${host}/users/${username}`
  const followingId = `${id}/following`

  const totalItems = await storage.getActorFollowingCount({ actorId: id })
  return Response.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followingId,
    type: 'OrderedCollection',
    totalItems
  })
})
