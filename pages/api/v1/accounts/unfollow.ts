import { unfollow } from '../../../../lib/activities'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { target } = req.body
      const follow = await storage.getAcceptedOrRequestedFollow(
        currentActor.id,
        target
      )
      if (!follow) {
        return res.status(404).json(ERROR_404)
      }

      await Promise.all([
        unfollow(currentActor, follow),
        storage.updateFollowStatus(follow.id, 'Undo')
      ])
      return res.status(200).json({ done: true })
    }
    default: {
      return res.status(404).json(ERROR_404)
    }
  }
})
export default handler
