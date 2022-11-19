import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  switch (req.method) {
    case 'POST': {
      return res.status(302).redirect('/')
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
