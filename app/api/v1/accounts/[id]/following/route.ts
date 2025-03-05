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
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const database = getDatabase()
  if (!database) {
    return apiErrorResponse(500)
  }

  const encodedAccountId = (await params?.params).id
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

  // Parse query parameters
  const url = new URL(req.url)
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10),
    MAX_LIMIT
  )
  const maxId = url.searchParams.get('max_id')
  const sinceId = url.searchParams.get('since_id')
  const minId = url.searchParams.get('min_id')

  // Get the list of follows for this actor using the database method
  const follows = await database.getFollowing({
    actorId: id,
    limit,
    maxId: maxId || undefined,
    sinceId: sinceId || undefined,
    minId: minId || undefined
  })

  // Get the target actors (the ones being followed)
  const followingActors = await Promise.all(
    follows.map((follow: Follow) =>
      database.getMastodonActorFromId({ id: follow.targetActorId })
    )
  )

  // Filter out any null results
  const validActors = followingActors.filter(Boolean)

  // Build Link header for pagination
  const additionalHeaders: [string, string][] = []
  if (follows.length > 0) {
    const linkHeader = []

    if (follows.length === limit) {
      const lastFollow = follows[follows.length - 1]
      const nextUrl = new URL(req.url)
      nextUrl.searchParams.set('max_id', lastFollow.id)
      linkHeader.push(`<${nextUrl.toString()}>; rel="next"`)
    }

    if (follows.length > 0 && (maxId || sinceId || minId)) {
      const firstFollow = follows[0]
      const prevUrl = new URL(req.url)
      prevUrl.searchParams.set('since_id', firstFollow.id)
      linkHeader.push(`<${prevUrl.toString()}>; rel="prev"`)
    }

    if (linkHeader.length > 0) {
      additionalHeaders.push(['Link', linkHeader.join(', ')])
    }
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: validActors,
    additionalHeaders
  })
}
