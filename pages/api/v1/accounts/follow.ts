import { follow } from '../../../../lib/activities'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { target } = req.body
      const followItem = await storage.createFollow(currentActor.id, target)
      await follow(followItem.id, currentActor, target)
      return res.status(200).json({ done: true })
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
