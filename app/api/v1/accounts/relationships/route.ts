import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getAccountRelationships',
  OAuthGuard([Scope.enum.read], async (req, context) => {
    const { database, currentActor } = context

    // Get account IDs from query parameters
    const url = new URL(req.url)
    const accountIds = url.searchParams.getAll('id[]')

    if (!accountIds.length) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: []
      })
    }

    // Fetch each account and build relationship data
    const relationships = await Promise.all(
      accountIds.map(async (encodedAccountId) => {
        try {
          const id = idToUrl(encodedAccountId)
          const actor = await database.getActorFromId({ id })

          if (!actor) {
            return null
          }

          return getRelationship({
            database,
            currentActor,
            targetActorId: actor.id
          })
        } catch (error) {
          logger.error(
            { error, accountId: encodedAccountId },
            `Error processing relationship for ID ${encodedAccountId}`
          )
          return null
        }
      })
    )

    // Filter out null values (failed lookups) and return the results
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: relationships.filter(Boolean)
    })
  })
)
