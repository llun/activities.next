import type { NextApiHandler } from 'next'
import { OutboxContext } from '../../../../lib/activities/context'
import { getConfig } from '../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../lib/errors'
import { getStorage } from '../../../../lib/storage'
import { getISOTimeUTC } from '../../../../lib/time'

const handle: NextApiHandler = async (req, res) => {
  const { account, page } = req.query
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(400).json(ERROR_400)
  }

  switch (req.method) {
    case 'GET': {
      const actorId = `https://${config.host}/users/${account}`
      if (!page) {
        const totalItems = await storage.getActorStatusesCount({ actorId })
        const id = `${actorId}/outbox`
        return res.status(200).json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id,
          type: 'OrderedCollection',
          totalItems,
          first: `${id}?page=true`,
          last: `${id}?min_id=0&page=true`
        })
      }

      const statuses = await storage.getActorStatuses({ actorId })
      return res.status(200).json({
        '@context': OutboxContext,
        id: `${actorId}/outbox?page=true`,
        type: 'OrderedCollectionPage',
        partOf: `${actorId}/outbox`,
        orderedItems: statuses.map((status) => ({
          id: `${status.id}/activity`,
          type: 'Create',
          actor: actorId,
          published: getISOTimeUTC(status.createdAt),
          to: status.to,
          cc: status.cc,
          object: {
            id: status.id,
            type: status.type,
            summary: status.summary,
            inReplyTo: null,
            published: getISOTimeUTC(status.createdAt),
            url: `https://${config.host}/@${account}/${new URL(
              status.id
            ).pathname
              .split('/')
              .pop()}`,
            attributedTo: status.actorId,
            to: status.to,
            cc: status.cc,
            sensitive: false,
            atomUri: status.id,
            inReplyToAtomUri: null,
            conversation: status.conversation,
            content: status.text,
            contentMap: {
              [status.language || 'en']: status.text
            },
            attachment: [],
            tag: [],
            replies: {
              id: status.reply,
              type: 'Collection',
              first: {
                type: 'CollectionPage',
                next: `${status.reply}?only_other_accounts=true&page=true`,
                partOf: status.reply,
                items: []
              }
            }
          }
        }))
      })
    }
    default:
      return res.status(404).json(ERROR_404)
  }
}

export default handle
