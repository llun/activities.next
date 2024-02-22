import { apiErrorResponse } from '@/lib/response'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { Timeline } from '@/lib/timelines/types'

const UNSUPPORTED_TIMELINE = [Timeline.LOCAL_PUBLIC]

interface Params {
  timeline: Timeline
}

export const GET = AuthenticatedGuard<Params>(async (req, context, params) => {
  const url = new URL(req.url)
  const startAfterStatusId = url.searchParams.get('startAfterStatusId')

  const { storage, currentActor } = context
  const { timeline } = params?.params ?? {}
  if (!timeline) return apiErrorResponse(400)

  if (
    !Object.values(Timeline).includes(timeline) ||
    UNSUPPORTED_TIMELINE.includes(timeline)
  ) {
    return apiErrorResponse(404)
  }

  const statuses = await storage.getTimeline({
    timeline,
    actorId: currentActor.id,
    startAfterStatusId
  })
  return Response.json({ statuses: statuses.map((item) => item.toJson()) })
})
