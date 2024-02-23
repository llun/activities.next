import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Timeline } from '@/lib/services/timelines/types'
import { Scope } from '@/lib/storage/types/oauth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const UNSUPPORTED_TIMELINE = [Timeline.LOCAL_PUBLIC]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  timeline: Timeline
}

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context, params) => {
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
    return apiResponse(req, CORS_HEADERS, {
      statuses: statuses.map((item) => item.toJson())
    })
  }
)
