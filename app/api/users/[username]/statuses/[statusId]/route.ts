import { ERROR_404 } from '../../../../../../lib/errors'
import { AppRouterParams } from '../../../../../../lib/guard'
import { ACTIVITY_STREAM_URL } from '../../../../../../lib/jsonld/activitystream'
import { OnlyLocalUserGuard, OnlyLocalUserGuardHandle } from '../../guard'

type StatusParams = OnlyLocalUserGuardHandle & {
  statusId: string
}

export const GET = OnlyLocalUserGuard(
  async (storage, actor, _, query: unknown) => {
    const { statusId } = (query as AppRouterParams<StatusParams>).params
    const id = `${actor.id}/statuses/${statusId}`
    const status = await storage.getStatus({ statusId: id, withReplies: true })
    if (!status) {
      return Response.json(ERROR_404, { status: 404 })
    }

    const note = status.toObject()
    if (!note) {
      return Response.json(ERROR_404, { status: 404 })
    }

    return Response.json({ '@context': ACTIVITY_STREAM_URL, ...note })
  }
)
