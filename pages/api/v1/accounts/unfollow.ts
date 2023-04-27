import { getPublicProfile, unfollow } from '../../../../lib/activities'
import { ApiGuard } from '../../../../lib/guard'
import { FollowStatus } from '../../../../lib/models/follow'
import { ERROR_404 } from '../../../../lib/responses'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'POST': {
      const { target } = req.body
      const follow = await storage.getAcceptedOrRequestedFollow({
        actorId: currentActor.id,
        targetActorId: target
      })
      if (!follow) {
        res.status(404).json(ERROR_404)
        return
      }

      await Promise.all([
        unfollow(currentActor, follow),
        storage.updateFollowStatus({
          followId: follow.id,
          status: FollowStatus.Undo
        })
      ])
      const profile = await getPublicProfile({ actorId: target })
      if (!profile) {
        res.redirect(302, '/')
        return
      }

      res.redirect(302, `/@${profile.username}@${profile.domain}`)
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
