import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Follow } from '@/lib/models/follow'
import { AppRouterParams } from '@/lib/services/guards/types'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getAccountFollowers',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiErrorResponse(400)
    }

    const id = idToUrl(encodedAccountId)
    const actor = await database.getActorFromId({
      id
    })

    if (!actor) {
      return apiErrorResponse(404)
    }

    const url = new URL(req.url)
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10),
      MAX_LIMIT
    )
    const maxId = url.searchParams.get('max_id')
    const minId =
      url.searchParams.get('min_id') || url.searchParams.get('since_id')

    const follows = await database.getFollowers({
      targetActorId: id,
      limit,
      maxId,
      minId
    })

    const followers = await Promise.all(
      follows.map((follow: Follow) =>
        database.getMastodonActorFromId({ id: follow.actorId })
      )
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: followers.filter(Boolean)
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
