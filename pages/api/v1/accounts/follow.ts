import { follow, getPublicProfile } from '../../../../lib/activities'
import { getConfig } from '../../../../lib/config'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { FollowStatus } from '../../../../lib/models/follow'

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  switch (req.method) {
    case 'GET': {
      const { targetActorId } = req.query
      if (!targetActorId) {
        return res.status(404).json(ERROR_404)
      }

      const follow = await storage.getAcceptedOrRequestedFollow({
        actorId: currentActor.id,
        targetActorId: targetActorId as string
      })
      return res.status(200).json({ follow })
    }
    case 'POST': {
      const { target } = req.body
      const followItem = await storage.createFollow({
        actorId: currentActor.id,
        targetActorId: target,
        status: FollowStatus.Requested,
        inbox: `${currentActor.id}/inbox`,
        sharedInbox: `https://${getConfig().host}/inbox`
      })
      await follow(followItem.id, currentActor, target)
      const profile = await getPublicProfile({ id: target })
      if (!profile) {
        return res.redirect(302, '/')
      }

      return res.redirect(302, `/@${profile.username}@${profile.domain}`)
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
