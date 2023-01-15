import { userAnnounce } from '../../../../lib/actions/announce'
import { userUndoAnnounce } from '../../../../lib/actions/undoAnnounce'
import { ApiGuard } from '../../../../lib/guard'
import { DEFAULT_202, ERROR_404 } from '../../../../lib/responses'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { statusId } = req.body
      await userAnnounce({ currentActor, statusId, storage })
      return res.status(202).json(DEFAULT_202)
    }
    case 'DELETE': {
      const { statusId } = req.body
      await userUndoAnnounce({ currentActor, statusId, storage })
      return res.status(202).json(DEFAULT_202)
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
