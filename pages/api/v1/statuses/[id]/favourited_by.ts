import { errorResponse } from '../../../../../lib/errors'
import { ApiGuard } from '../../../../../lib/guard'
import { getFirstValueFromParsedQuery } from '../../../../../lib/query'
import { ApiTrace } from '../../../../../lib/trace'

const handler = ApiTrace(
  'v1/statuses/[id]/favourited_by',
  ApiGuard(async (req, res, context) => {
    const { id } = req.query
    const { storage, currentActor } = context
    switch (req.method) {
      case 'GET': {
        const uuid = getFirstValueFromParsedQuery(id)
        if (!uuid) {
          return errorResponse(res, 400)
        }

        const statusId = `${currentActor.id}/statuses/${uuid}`
        const actors = await storage.getFavouritedBy({ statusId })
        res.status(200).json(actors.map((actor) => actor.toMastodonModel()))
        return
      }
      default:
        return errorResponse(res, 404)
    }
  })
)

export default handler
