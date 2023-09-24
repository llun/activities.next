import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      await storage.updateActor({
        actorId: currentActor.id,
        ...req.body
      })
      res.redirect(302, '/settings')
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
