import type { NextApiHandler } from 'next'

import { headerHost } from '../../../../lib/guard'
import { ERROR_400, ERROR_404 } from '../../../../lib/responses'
import { getStorage } from '../../../../lib/storage'
import { getISOTimeUTC } from '../../../../lib/time'

const handle: NextApiHandler = async (req, res) => {
  const { username, page } = req.query
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  const host = headerHost(req.headers)
  switch (req.method) {
    case 'GET': {
      const id = `https://${host}/users/${username}`
      if (!page) {
        const totalItems = await storage.getActorStatusesCount({ actorId: id })
        const inboxId = `${id}/outbox`
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
      const items = await Promise.all(
        statuses.map(async (status) => {
          return {
            id: `${status.data.id}/activity`,
            type: 'Create',
            actor: id,
            published: getISOTimeUTC(status.data.createdAt),
            // TODO: Fix the to and cc store in database
            to: status.data.to || null,
            cc: status.data.cc || null,
            object: status.toObject()
          }
        })
      )

      return res.status(200).json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${id}/outbox?page=true`,
        type: 'OrderedCollectionPage',
        partOf: `${id}/outbox`,
        orderedItems: items
      })
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
