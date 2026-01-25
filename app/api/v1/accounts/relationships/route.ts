import { Mastodon } from '@llun/activities.schema'

import { Scope } from '@/lib/database/types/oauth'
import { FollowStatus } from '@/lib/models/follow'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

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

          const [isFollowing, isFollowedBy, follow] = await Promise.all([
            database.isCurrentActorFollowing({
              currentActorId: currentActor.id,
              followingActorId: id
            }),
            database.isCurrentActorFollowing({
              currentActorId: id,
              followingActorId: currentActor.id
            }),
            database.getAcceptedOrRequestedFollow({
              actorId: currentActor.id,
              targetActorId: id
            })
          ])

          const isRequested =
            follow && follow.status === FollowStatus.enum.Requested

          // For now, we'll set default values for capabilities not yet implemented
          // In a full implementation, you would check for blocks, mutes, etc.
          return Mastodon.Relationship.parse({
            id: urlToId(id),
            following: isFollowing,
            showing_reblogs: isFollowing,
            notifying: false,
            followed_by: isFollowedBy,
            blocking: false,
            blocked_by: false,
            muting: false,
            muting_notifications: false,
            requested: isRequested,
            requested_by: false,
            domain_blocking: false,
            endorsed: false,
            languages: ['en'],
            note: actor.summary ?? ''
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
