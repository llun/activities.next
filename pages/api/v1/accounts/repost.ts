import { userAnnounce } from '../../../../lib/actions/announce'
import { userUndoAnnounce } from '../../../../lib/actions/undoAnnounce'
import { DEFAULT_202, ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { statusId } = req.body
      await userAnnounce({ currentActor, statusId, storage })
      res.status(202).json(DEFAULT_202)
      return
    }
    case 'DELETE': {
      const { statusId } = req.body
      await userUndoAnnounce({ currentActor, statusId, storage })
      res.status(202).json(DEFAULT_202)
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
