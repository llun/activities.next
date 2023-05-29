import { sendLike, sendUndoLike } from '../../../../lib/activities'
import { DEFAULT_202, ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { statusId } = req.body
      const status = await storage.getStatus({ statusId, withReplies: false })
      if (!status) {
        res.status(404).json(ERROR_404)
        return
      }

      await storage.createLike({ actorId: currentActor.id, statusId })
      await sendLike({ currentActor, status })
      res.status(202).json(DEFAULT_202)
      return
    }
    case 'DELETE': {
      const { statusId } = req.body
      const status = await storage.getStatus({ statusId, withReplies: false })
      if (!status) {
        res.status(404).json(ERROR_404)
        return
      }

      await storage.deleteLike({ actorId: currentActor.id, statusId })
      await sendUndoLike({ currentActor, status })
      res.status(202).json(DEFAULT_202)
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
