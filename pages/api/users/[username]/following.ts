import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { headerHost } from '../../../../lib/guard'
import { ERROR_400, ERROR_404 } from '../../../../lib/responses'
import { getStorage } from '../../../../lib/storage'

const handle: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { username, page } = req.query
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  const host = headerHost(req.headers)
  const id = `https://${host}/users/${username}`
  const followingId = `${id}/following`

  switch (req.method) {
    case 'GET': {
      if (!page) {
        const totalItems = await storage.getActorFollowingCount({ actorId: id })
        return res.status(200).json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: followingId,
          type: 'OrderedCollection',
          totalItems
        })
      }
      return res.status(404).json(ERROR_404)
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
