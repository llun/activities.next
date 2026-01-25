import { z } from 'zod'

import { getConfig } from '@/lib/config'
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

const SearchParams = z.object({
  q: z.string(),
  limit: z.coerce.number().min(1).max(80).default(40).optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
  resolve: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  following: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
})

export const GET = traceApiRoute(
  'searchAccounts',
  OAuthGuard([Scope.enum.read], async (req, context) => {
    const { database } = context

    const url = new URL(req.url)
    const queryParams: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value
    })

    const parsedParams = SearchParams.safeParse(queryParams)
    if (!parsedParams.success) {
      return apiErrorResponse(400)
    }

    const { q, limit = 40 } = parsedParams.data

    if (!q || q.trim().length === 0) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: []
      })
    }

    const query = q.trim()
    const results = []

    // Try exact match first (username@domain or just username)
    if (query.includes('@')) {
      const [username, domain] = query.split('@')
      if (username && domain) {
        const actor = await database.getActorFromUsername({ username, domain })
        if (actor) {
          const mastodonActor = await database.getMastodonActorFromId({
            id: actor.id
          })
          if (mastodonActor) results.push(mastodonActor)
        }
      }
    } else {
      // Try as local username
      const actor = await database.getActorFromUsername({
        username: query,
        domain: getConfig().host
      })
      if (actor) {
        const mastodonActor = await database.getMastodonActorFromId({
          id: actor.id
        })
        if (mastodonActor) results.push(mastodonActor)
      }
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: results.slice(0, limit)
    })
  })
)
