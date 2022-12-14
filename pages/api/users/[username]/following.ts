import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { getConfig } from '../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../lib/errors'
import { getStorage } from '../../../../lib/storage'

const handle: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { username, page } = req.query
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  const id = `https://${config.host}/users/${username}`
  const followingId = `${id}/following`

  switch (req.method) {
    case 'GET': {
      if (!page) {
        const totalItems = await storage.getActorFollowingCount({ actorId: id })
        return res.status(200).json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: followingId,
          type: 'OrderedCollection',
          totalItems,
          first: `${id}?page=1`
        })
      }
      return res.status(404).json(ERROR_404)
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
