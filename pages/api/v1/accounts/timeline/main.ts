import { ApiGuard } from '../../../../../lib/guard'
import { ERROR_404 } from '../../../../../lib/responses'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'GET': {
      return res.status(202).json([])
    }
    default: {
      return res.status(404).json(ERROR_404)
    }
  }
})
export default handler
