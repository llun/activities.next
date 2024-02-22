import { z } from 'zod'

import { userAnnounce } from '@/lib/actions/announce'
import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { DEFAULT_202, defaultStatusOption } from '@/lib/response'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

const RepostRequest = z.object({ statusId: z.string() })
type RepostRequest = z.infer<typeof RepostRequest>

export const POST = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { statusId } = RepostRequest.parse(body)
  await userAnnounce({ currentActor, statusId, storage })
  return Response.json(DEFAULT_202, defaultStatusOption(202))
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { statusId } = RepostRequest.parse(body)
  await userUndoAnnounce({ currentActor, statusId, storage })
  return Response.json(DEFAULT_202, defaultStatusOption(202))
})
