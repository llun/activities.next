import { z } from 'zod'

import { userAnnounce } from '../../../../../lib/actions/announce'
import { userUndoAnnounce } from '../../../../../lib/actions/undoAnnounce'
import { DEFAULT_202 } from '../../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../../lib/guard'

const RepostRequest = z.object({ statusId: z.string() })
type RepostRequest = z.infer<typeof RepostRequest>

export const POST = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { statusId } = RepostRequest.parse(body)
  await userAnnounce({ currentActor, statusId, storage })
  return Response.json(DEFAULT_202, { status: 202 })
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { statusId } = RepostRequest.parse(body)
  await userUndoAnnounce({ currentActor, statusId, storage })
  return Response.json(DEFAULT_202, { status: 202 })
})
