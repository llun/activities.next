import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { FeaturedOrderedCollection } from '../../../../../lib/activities/entities/featuredOrderedCollection'
import { getConfig } from '../../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../../lib/errors'
import { getStorage } from '../../../../../lib/storage'

const handle: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { actorId } = req.query
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  const id = `https://${config.host}/users/${actorId}`
  switch (req.method) {
    case 'GET': {
      const json: FeaturedOrderedCollection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${id}/collections/featured`,
        type: 'OrderedCollection',
        totalItems: 0,
        orderedItems: []
      }
      return res.status(200).json(json)
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
