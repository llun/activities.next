import { sendLike, sendUndoLike } from '@/lib/activities'
import {
  DEFAULT_202,
  apiErrorResponse,
  defaultStatusOption
} from '@/lib/errors'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

import { LikeStatusRequest } from './types'

export const POST = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { statusId } = LikeStatusRequest.parse(body)
  const status = await storage.getStatus({ statusId, withReplies: false })
  if (!status) return apiErrorResponse(404)

  await storage.createLike({ actorId: currentActor.id, statusId })
  await sendLike({ currentActor, status })
  return Response.json(DEFAULT_202, defaultStatusOption(202))
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { statusId } = LikeStatusRequest.parse(body)
  const status = await storage.getStatus({ statusId, withReplies: false })
  if (!status) return apiErrorResponse(404)

  await storage.deleteLike({ actorId: currentActor.id, statusId })
  await sendUndoLike({ currentActor, status })
  return Response.json(DEFAULT_202, defaultStatusOption(202))
})
