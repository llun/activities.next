import { userAnnounce } from '../../../../lib/actions/announce'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { statusId } = req.body
      await userAnnounce({ currentActor, statusId, storage })
      return res.status(200).json({ done: true })
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
