import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      const updatedActor = {
        ...currentActor,
        ...req.body
      }
      await storage.updateActor({ actor: updatedActor })
      return res.status(301).redirect('/profile')
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
