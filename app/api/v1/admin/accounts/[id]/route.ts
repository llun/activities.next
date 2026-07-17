import { NextRequest } from 'next/server'

import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import {
  hydrateAdminAccounts,
  resolveAdminAccountRecord
} from '@/lib/services/admin/serializeAdminAccounts'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.DELETE
]

type Params = { id: string }

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminGetAccount',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params }) => {
      const { id } = await params
      const record = await resolveAdminAccountRecord(database, id)
      if (!record) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }
      const [entity] = await hydrateAdminAccounts(database, [record])
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
    },
    { resource: 'accounts' }
  )
)

// Irreversible hard delete. Mastodon requires the account to be suspended
// first, so this 422s otherwise; then it reuses the existing purge pipeline
// (scheduleActorDeletion + DELETE_ACTOR_JOB_NAME), which also handles remote
// (account-less) actors. Returns the pre-deletion snapshot.
export const DELETE = traceApiRoute(
  'adminDeleteAccount',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params, moderator }) => {
      const { id } = await params
      const record = await resolveAdminAccountRecord(database, id)
      if (!record) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      if (!record.actor.suspendedAt) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Account must be suspended before deletion' },
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      const [snapshot] = await hydrateAdminAccounts(database, [record])
      const actorId = record.actor.id

      await database.scheduleActorDeletion({ actorId, scheduledAt: null })
      await getQueue().publish({
        id: `admin-delete-actor-${actorId}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId }
      })
      await database.createModerationAction({
        targetActorId: actorId,
        moderatorAccountId: moderator.accountId ?? '',
        moderatorActorId: moderator.actorId,
        action: 'destroy'
      })

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: snapshot })
    },
    { resource: 'accounts' }
  )
)
