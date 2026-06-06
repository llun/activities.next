import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

// Upper bound on how many of a target's followers we scan when computing the
// intersection with the current user's follows. Keeps the work bounded for
// popular targets.
const FAMILIAR_FOLLOWER_SCAN_LIMIT = 500

// Upper bound on how many target accounts a single request may ask about.
const MAX_FAMILIAR_FOLLOWER_TARGETS = 40

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/accounts/familiar_followers — accounts you follow that also
// follow the requested account(s).
// https://docs.joinmastodon.org/methods/accounts/#familiar_followers
// Scope: read:follows (satisfied by aggregate `read`).
export const GET = traceApiRoute(
  'getFamiliarFollowers',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, context) => {
      const { database, currentActor } = context

      const url = new URL(req.url)
      // Deduplicate and bound the requested ids to avoid pathological fan-out
      // (each id triggers a follower scan + intersection).
      const encodedIds = Array.from(
        new Set(
          [
            ...url.searchParams.getAll('id[]'),
            ...url.searchParams.getAll('id')
          ].filter(Boolean)
        )
      ).slice(0, MAX_FAMILIAR_FOLLOWER_TARGETS)

      if (encodedIds.length === 0) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

      // First resolve each target's familiar-follower ids (the accounts the
      // current user follows that also follow the target). Per-target scans run
      // in parallel and are bounded by the dedupe+cap above.
      const perTarget = await Promise.all(
        encodedIds.map(async (encodedId) => {
          const targetActorId = idToUrl(encodedId)
          const target = await database.getActorFromId({ id: targetActorId })
          if (!target) return { id: encodedId, familiarIds: [] as string[] }

          // The target's followers (accounts whose `actorId` follows target)...
          const followers = await database.getFollowers({
            targetActorId,
            limit: FAMILIAR_FOLLOWER_SCAN_LIMIT
          })
          const followerActorIds = followers
            .map((follow) => follow.actorId)
            .filter((actorId) => actorId !== currentActor.id)

          // ...intersected with the accounts the current user follows.
          const familiarIds =
            followerActorIds.length > 0
              ? await database.getAcceptedFollowTargetActorIds({
                  actorId: currentActor.id,
                  targetActorIds: followerActorIds
                })
              : []

          return { id: urlToId(target.id), familiarIds }
        })
      )

      // Hydrate every familiar account across all targets in a single batch.
      const uniqueIds = [...new Set(perTarget.flatMap((t) => t.familiarIds))]
      const accountsById = new Map(
        (await database.getMastodonActorsFromIds({ ids: uniqueIds })).map(
          (account) => [account.url, account]
        )
      )

      const results = perTarget.map((target) => ({
        id: target.id,
        accounts: target.familiarIds
          .map((id) => accountsById.get(id))
          .filter((account): account is NonNullable<typeof account> =>
            Boolean(account)
          )
      }))

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: results })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
