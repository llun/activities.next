import { ApiGuard } from '../../../../lib/guard'
import { ERROR_404 } from '../../../../lib/responses'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      await storage.updateActor({
        actorId: currentActor.id,
        ...req.body
      })
      res.status(301).redirect('/profile')
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
