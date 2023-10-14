import { errorResponse } from '../../../../../lib/errors'
import { ApiGuard } from '../../../../../lib/guard'
import { getFirstValueFromParsedQuery } from '../../../../../lib/query'
import { ApiTrace } from '../../../../../lib/trace'

const handler = ApiTrace(
  'v1/statuses/[id]/favourited_by',
  ApiGuard(async (req, res) => {
    const { id } = req.query
    switch (req.method) {
      case 'GET': {
        const uuid = getFirstValueFromParsedQuery(id)
        if (!uuid) {
          return errorResponse(res, 400)
        }

        res.status(200).json([])
        return
      }
      default:
        return errorResponse(res, 404)
    }
  })
)

export default handler
