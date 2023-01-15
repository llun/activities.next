import type { NextApiHandler } from 'next'

import { getConfig } from '../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../lib/responses'
import { getStorage } from '../../../../lib/storage'

const handle: NextApiHandler = async (req, res) => {
  const { username, page } = req.query
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  const id = `https://${config.host}/users/${username}`
  const followerId = `${id}/followers`

  switch (req.method) {
    case 'GET': {
      if (!page) {
        const totalItems = await storage.getActorFollowersCount({ actorId: id })
        return res.status(200).json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: followerId,
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
