import type { NextApiHandler } from 'next'

import { getConfig } from '../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../lib/errors'
import { toObject } from '../../../../lib/models/status'
import { getStorage } from '../../../../lib/storage'
import { getISOTimeUTC } from '../../../../lib/time'

const handle: NextApiHandler = async (req, res) => {
  const { actorId, page } = req.query
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  switch (req.method) {
    case 'GET': {
      const id = `https://${config.host}/users/${actorId}`
      if (!page) {
        const totalItems = await storage.getActorStatusesCount({ actorId: id })
        const inboxId = `${actorId}/outbox`
        return res.status(200).json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: inboxId,
          type: 'OrderedCollection',
          totalItems,
          first: `${inboxId}?page=true`,
          last: `${inboxId}?min_id=0&page=true`
        })
      }

      const statuses = await storage.getActorStatuses({ actorId: id })
      return res.status(200).json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${id}/outbox?page=true`,
        type: 'OrderedCollectionPage',
        partOf: `${id}/outbox`,
        orderedItems: statuses.map((status) => ({
          id: `${status.id}/activity`,
          type: 'Create',
          actor: id,
          published: getISOTimeUTC(status.createdAt),
          to: status.to,
          cc: status.cc,
          object: toObject({ status })
        }))
      })
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
