import type { NextApiRequest, NextApiResponse } from 'next'

import { acceptFollowRequest } from '../../../../lib/actions/acceptFollowRequest'
import { createFollower } from '../../../../lib/actions/createFollower'
import { rejectFollowRequest } from '../../../../lib/actions/rejectFollowRequest'
import { FollowRequest } from '../../../../lib/activities/actions/follow'
import { UndoFollow } from '../../../../lib/activities/actions/undoFollow'
import { ERROR_400, ERROR_404 } from '../../../../lib/errors'
import { activitiesGuard } from '../../../../lib/guard'
import { FollowStatus } from '../../../../lib/models/follow'
import { getStorage } from '../../../../lib/storage'

export default activitiesGuard(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === 'POST') {
      const activity =
        typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      const storage = await getStorage()
      if (!storage) {
        return res.status(400).json(ERROR_400)
      }

      switch (activity.type) {
        case 'Accept': {
          const follow = await acceptFollowRequest({ activity, storage })
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          return res.status(202).send('')
        }
        case 'Reject': {
          const follow = await rejectFollowRequest({ activity, storage })
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          return res.status(202).send('')
        }
        case 'Follow': {
          const follow = await createFollower({
            followRequest: activity as FollowRequest,
            storage
          })
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          return res.status(202).send({ target: follow.object })
        }
        case 'Undo': {
          const undoRequest = activity as UndoFollow
          const follow = await storage.getAcceptedOrRequestedFollow({
            actorId: undoRequest.object.actor,
            targetActorId: undoRequest.object.object
          })
          if (!follow) {
            console.error('Fail to find follow', undoRequest)
            return res.status(404).json(ERROR_404)
          }
          await storage.updateFollowStatus({
            followId: follow.id,
            status: FollowStatus.Undo
          })
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
