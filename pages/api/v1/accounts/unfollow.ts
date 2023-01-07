import { getPublicProfile, unfollow } from '../../../../lib/activities'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { FollowStatus } from '../../../../lib/models/follow'

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
        return res.status(404).json(ERROR_404)
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
        return res.redirect(302, '/')
      }

      return res.redirect(302, `/@${profile.username}@${profile.domain}`)
    }
    default: {
      return res.status(404).json(ERROR_404)
    }
  }
})
export default handler
