import type { NextApiHandler } from 'next'

import {
  AnnounceAction,
  CreateAction
} from '../../../../lib/activities/actions/types'
import { headerHost } from '../../../../lib/guard'
import { StatusType } from '../../../../lib/models/status'
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
      const items = statuses.map((status) => {
        if (status.data.type === StatusType.Announce) {
          return {
            id: status.id,
            type: AnnounceAction,
            actor: id,
            published: getISOTimeUTC(status.createdAt),
            ...(status.to ? { to: status.to } : null),
            ...(status.cc ? { cc: status.cc } : null),
            object: status.data.originalStatus.id
          }
        }

        return {
          id: `${status.id}/activity`,
          type: CreateAction,
          actor: id,
          published: getISOTimeUTC(status.createdAt),
          ...(status.to ? { to: status.to } : null),
          ...(status.cc ? { cc: status.cc } : null),
          object: status.toObject()
        }
      })

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
