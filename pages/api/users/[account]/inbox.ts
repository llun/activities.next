import type { NextApiRequest, NextApiResponse } from 'next'
import { acceptFollow } from '../../../../lib/activities'
import { AcceptFollow } from '../../../../lib/activities/actions/acceptFollow'
import { FollowRequest } from '../../../../lib/activities/actions/follow'
import { UndoFollow } from '../../../../lib/activities/actions/undoFollow'
import { getConfig } from '../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../lib/errors'
import { activitiesGuard } from '../../../../lib/guard'

import { getStorage } from '../../../../lib/storage'

export default activitiesGuard(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === 'POST') {
      const activity = JSON.parse(req.body)
      const storage = await getStorage()
      if (!storage) {
        return res.status(400).json(ERROR_400)
      }

      switch (activity.type) {
        case 'Accept': {
          const acceptFollow = activity as AcceptFollow
          const followId = acceptFollow.object.id.substring(
            `https://${getConfig().host}/`.length
          )
          const follow = await storage.getFollowFromId(followId)
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          // TODO: Pull outbox after accepted
          await storage.updateFollowStatus(followId, 'Accepted')
          return res.status(202).send('')
        }
        case 'Reject': {
          const rejectFollow = activity as AcceptFollow
          const followId = rejectFollow.object.id.substring(
            `https://${getConfig().host}/`.length
          )
          const follow = await storage.getFollowFromId(followId)
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          await storage.updateFollowStatus(followId, 'Rejected')
          return res.status(202).send('')
        }
        case 'Follow': {
          const followRequest = activity as FollowRequest
          const actor = await storage.getActorFromId(followRequest.object)
          if (!actor) {
            console.log('No actor found')
            return res.status(404).json(ERROR_404)
          }

          await Promise.all([
            await storage.createFollow(
              followRequest.actor,
              followRequest.object
            ),
            await acceptFollow(actor, followRequest)
          ])
          return res.status(202).send({ target: followRequest.object })
        }
        case 'Undo': {
          const undoRequest = activity as UndoFollow
          const followId = undoRequest.object.id.substring(
            `https://${getConfig().host}/`.length
          )
          const follow = await storage.getFollowFromId(followId)
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          await storage.updateFollowStatus(followId, 'Undo')
          return res.status(202).send({ target: undoRequest.object.object })
        }
        default:
          return res.status(202).send('')
      }
    }

    return res.status(404).json(ERROR_404)
  },
  ['POST']
)
