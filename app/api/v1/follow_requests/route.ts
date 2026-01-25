import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFollowRequests',
  OAuthGuard([Scope.enum.read], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const url = new URL(req.url)
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '40', 10),
      80
    )
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const offset = (page - 1) * limit

    const followRequests = await database.getFollowRequests({
      targetActorId: currentActor.id,
      limit,
      offset
    })

    // Convert follow objects to Mastodon Account format
    const accounts = await Promise.all(
      followRequests.map(async (follow) => {
        return database.getMastodonActorFromId({ id: follow.actorId })
      })
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: accounts.filter(Boolean)
    })
  })
)
