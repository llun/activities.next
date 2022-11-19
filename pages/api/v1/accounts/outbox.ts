import crypto from 'crypto'
import format from 'date-fns/format'

import { getConfig } from '../../../../lib/config'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { getUsernameFromId } from '../../../../lib/models/actor'
import { Status } from '../../../../lib/models/status'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  const config = getConfig()
  switch (req.method) {
    case 'POST': {
      const currentTime = Date.now()
      const body = req.body
      const postId = crypto.randomUUID()
      const id = `${currentActor.id}/statuses/${postId}`
      const status: Status = {
        id: `${currentActor.id}/statuses/${postId}`,
        url: `https://${config.host}/@${getUsernameFromId(
          currentActor.id
        )}/${postId}`,
        actorId: currentActor.id,
        type: 'Note',
        text: `<p>${body.message}</p>`,
        summary: null,
        conversation: `tag:${config.host},${format(
          currentTime,
          'yyyy-MM-dd'
        )}:objectId=${crypto.randomUUID()}:objectType=Conversation`,
        mediaAttachmentIds: [],
        visibility: 'public',
        sensitive: false,
        language: 'en',
        reply: `${id}/replies`,
        createdAt: currentTime
      }
      await storage.createStatus(status)
      return res.status(302).redirect('/')
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
