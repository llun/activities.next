import { sendLike, sendUndoLike } from '../../../../lib/activities'
import { ApiGuard } from '../../../../lib/guard'
import { DEFAULT_202, ERROR_404 } from '../../../../lib/responses'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { statusId } = req.body
      const status = await storage.getStatus({ statusId })
      if (!status) return res.status(404).json(ERROR_404)

      await storage.createLike({ actorId: currentActor.id, statusId })
      await sendLike({ currentActor, status })
      return res.status(202).json(DEFAULT_202)
    }
    case 'DELETE': {
      const { statusId } = req.body
      const status = await storage.getStatus({ statusId })
      if (!status) return res.status(404).json(ERROR_404)

      await storage.deleteLike({ actorId: currentActor.id, statusId })
      await sendUndoLike({ currentActor, status })
      return res.status(202).json(DEFAULT_202)
    }
    default: {
      return res.status(404).json(ERROR_404)
    }
  }
})
export default handler
