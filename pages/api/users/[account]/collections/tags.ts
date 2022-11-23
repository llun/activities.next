import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { HashTagCollection } from '../../../../../lib/activities/entities/hashTagCollection'
import { getConfig } from '../../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../../lib/errors'
import { getStorage } from '../../../../../lib/storage'

const handle: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const { account } = req.query
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  const actorId = `https://${config.host}/users/${account}`
  switch (req.method) {
    case 'GET': {
      const json: HashTagCollection = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          {
            Hashtag: 'as:Hashtag'
          }
        ],
        id: `${actorId}/collections/tags`,
        type: 'Collection',
        totalItems: 0,
        items: []
      }
      return res.status(200).json(json)
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
