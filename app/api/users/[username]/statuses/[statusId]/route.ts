import { ERROR_404, defaultStatusOption } from '@/lib/errors'
import { ACTIVITY_STREAM_URL } from '@/lib/jsonld/activitystream'
import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardHandle
} from '@/lib/services/guards/OnlyLocalUserGuard'
import { AppRouterParams } from '@/lib/services/guards/types'

type StatusParams = OnlyLocalUserGuardHandle & {
  statusId: string
}

export const GET = OnlyLocalUserGuard(
  async (storage, actor, _, query: unknown) => {
    const { statusId } = (query as AppRouterParams<StatusParams>).params
    const id = `${actor.id}/statuses/${statusId}`
    const status = await storage.getStatus({ statusId: id, withReplies: true })
    if (!status) {
      return Response.json(ERROR_404, defaultStatusOption(404))
    }

    const note = status.toObject()
    if (!note) {
      return Response.json(ERROR_404, defaultStatusOption(404))
    }

    return Response.json({ '@context': ACTIVITY_STREAM_URL, ...note })
  }
)
