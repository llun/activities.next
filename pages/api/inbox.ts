import * as jsonld from 'jsonld'
import type { NextApiHandler } from 'next'

import { StatusActivity } from '../../lib/activities/actions/status'
import { Note } from '../../lib/activities/entities/note'
import { Question } from '../../lib/activities/entities/question'
import { ERROR_404, ERROR_500 } from '../../lib/errors'
import { activitiesGuard } from '../../lib/guard'
import { CONTEXT } from '../../lib/models/activitystream.context'
import { fromJson } from '../../lib/models/status'
import { getStorage } from '../../lib/storage'
import { Storage } from '../../lib/storage/types'

const getAttachments = (object: Note | Question) => {
  if (!object.attachment) return null
  if (Array.isArray(object.attachment)) return object.attachment
  return [object.attachment]
}

interface HandleCreateParams {
  storage: Storage
  object: Note | Question
}
export const handleCreate = async ({ storage, object }: HandleCreateParams) => {
  const status = fromJson(object)
  await storage.createStatus({ status })

  const attachments = getAttachments(object)
  if (attachments) {
    await Promise.all([
      attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return

        await storage.createAttachment({
          statusId: status.id,
          mediaType: attachment.mediaType,
          height: attachment.height,
          width: attachment.width,
          name: attachment.name || '',
          url: attachment.url
        })
      })
    ])
  }
  return {
    status: 202,
    data: ''
  }
}

const customJsonLD = jsonld as any
const nodeDocumentLoader = customJsonLD.documentLoaders.node()

export const compact = async (activity: StatusActivity) => {
  const context = {
    '@context': 'https://www.w3.org/ns/activitystreams'
  }
  const compactedActivity = await jsonld.compact(activity, context, {
    async documentLoader(url) {
      if (url === 'https://www.w3.org/ns/activitystreams') {
        return {
          contextUrl: null, // this is for a context via a link header
          document: CONTEXT, // this is the actual document that was loaded
          documentUrl: url // this is the actual context URL after redirects
        }
      }
      return nodeDocumentLoader(url)
    }
  })
  return compactedActivity as unknown
}

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const body = (await compact(JSON.parse(req.body))) as StatusActivity
    const storage = await getStorage()
    if (!storage) {
      return res.status(500).send(ERROR_500)
    }

    switch (body.type) {
      case 'Create': {
        const { status, data } = await handleCreate({
          storage,
          object: body.object
        })
        return res.status(status).send(data)
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler
