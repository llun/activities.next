import z from 'zod'

import { errorResponse } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { getFirstValueFromParsedQuery } from '../../../../lib/query'
import { ApiTrace } from '../../../../lib/trace'

const EditNoteSchema = z.object({
  status: z.string()
})

export type EditNoteSchema = z.infer<typeof EditNoteSchema>

const handler = ApiTrace(
  'v1/statuses/[id]',
  ApiGuard(async (req, res, context) => {
    const { id } = req.query
    const { storage, currentActor } = context
    switch (req.method) {
      case 'PUT': {
        const statusId = getFirstValueFromParsedQuery(id)
        if (!statusId) {
          return errorResponse(res, 400)
        }

        const status = await storage.getStatus({
          statusId
        })
        if (currentActor.id !== status?.actorId) {
          return errorResponse(res, 403)
        }

        res.status(200).json({ ok: true })
        return
      }
      default: {
        return errorResponse(res, 404)
      }
    }
  })
)
export default handler
