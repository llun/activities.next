import { z } from 'zod'

import {
  dropHideMatchesFromStatuses,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveStatusIdParams } from '@/lib/services/mastodon/resolveClientId'
import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import { filterBlockedStatuses } from '@/lib/services/timelines/blockFilter'
import { filterDomainBlockedStatuses } from '@/lib/services/timelines/domainBlockFilter'
import { filterModeratedStatuses } from '@/lib/services/timelines/moderationFilter'
import { filterMutedStatuses } from '@/lib/services/timelines/muteFilter'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const ReconcileStatusesSchema = z.object({
  statusIds: z.array(z.string().trim().min(1).max(2048)).min(1).max(80)
})

export const POST = traceApiRoute(
  'reconcileStatuses',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { currentActor, database }) => {
      try {
        const body = await req.json().catch(() => null)
        const parseResult = ReconcileStatusesSchema.safeParse(body)
        if (!parseResult.success) {
          return apiCorsError(req, CORS_HEADERS, 400)
        }

        const { statusIds } = parseResult.data

        const resolvedStatusIds = await resolveStatusIdParams(
          database,
          statusIds
        )

        const uniqueResolvedIds = [...new Set(resolvedStatusIds)].filter(
          Boolean
        )

        const fetchedStatuses =
          uniqueResolvedIds.length > 0
            ? await database.getStatusesByIds({
                statusIds: uniqueResolvedIds,
                currentActorId: currentActor.id
              })
            : []

        const readableStatuses = await filterReadableStatuses({
          database,
          statuses: fetchedStatuses,
          currentActor
        })

        const blockedDomains = new Set(
          currentActor.id
            ? (
                await database.getActorDomainBlocks({
                  actorId: currentActor.id
                })
              ).map((block) => block.domain)
            : []
        )

        const domainFiltered = filterDomainBlockedStatuses(
          blockedDomains,
          readableStatuses
        )

        const blockFiltered = await filterBlockedStatuses(
          database,
          currentActor.id,
          domainFiltered
        )

        const muteFiltered = await filterMutedStatuses(
          database,
          currentActor.id,
          blockFiltered
        )

        const moderationFiltered = await filterModeratedStatuses(
          database,
          muteFiltered,
          true
        )

        const filterRecords = await getActiveFilters(
          database,
          currentActor.id,
          'home'
        )

        const visibleStatuses =
          filterRecords.length > 0
            ? dropHideMatchesFromStatuses(moderationFiltered, filterRecords)
            : moderationFiltered

        const visibleById = new Map(
          visibleStatuses.map((s) => [s.id, cleanJson(s)])
        )
        const visibleByPublicId = new Map(
          visibleStatuses
            .filter((s) => Boolean(s.publicId))
            .map((s) => [s.publicId as string, cleanJson(s)])
        )

        const removedStatusIds: string[] = []
        const seenRemoved = new Set<string>()

        for (let i = 0; i < statusIds.length; i++) {
          const rawId = statusIds[i]
          const resolvedId = resolvedStatusIds[i]
          const isVisible =
            visibleById.has(rawId) ||
            (resolvedId ? visibleById.has(resolvedId) : false) ||
            visibleByPublicId.has(rawId)

          if (!isVisible && !seenRemoved.has(rawId)) {
            removedStatusIds.push(rawId)
            seenRemoved.add(rawId)
          }
        }

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            statuses: Array.from(visibleById.values()),
            removedStatusIds
          }
        })
      } catch (e) {
        logger.error({
          message: 'Failed to reconcile statuses',
          err: toLoggableError(e)
        })
        return apiCorsError(req, CORS_HEADERS, 500)
      }
    }
  )
)
