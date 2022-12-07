import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      console.log(req.body)
      return res.status(200).json({})
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
