import { NextRequest } from 'next/server'
import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { NotificationPolicyValue, Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const UpdatePolicyBody = z.object({
  for_not_following: NotificationPolicyValue.optional(),
  for_not_followers: NotificationPolicyValue.optional(),
  for_new_accounts: NotificationPolicyValue.optional(),
  for_private_mentions: NotificationPolicyValue.optional(),
  for_limited_accounts: NotificationPolicyValue.optional()
})

const buildPolicyResponse = async (database: Database, actorId: string) => {
  const [policy, pendingNotificationsCount, pendingRequestsCount] =
    await Promise.all([
      database.getNotificationPolicy({ actorId }),
      database.getNotificationsCount({ actorId, filteredOnly: true }),
      database.getNotificationRequestsCount({ actorId })
    ])

  return {
    ...policy,
    summary: {
      pending_requests_count: pendingRequestsCount,
      pending_notifications_count: pendingNotificationsCount
    }
  }
}

export const GET = traceApiRoute(
  'getNotificationPolicy',
  OAuthGuard([Scope.enum.read], async (req, { currentActor, database }) => {
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const data = await buildPolicyResponse(database, currentActor.id)
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  })
)

export const PATCH = traceApiRoute(
  'updateNotificationPolicy',
  OAuthGuard(
    [Scope.enum.write],
    async (req: NextRequest, { currentActor, database }) => {
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const contentType = req.headers.get('content-type') ?? ''
      let body: unknown
      if (
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.includes('multipart/form-data')
      ) {
        const formData = await req.formData().catch(() => null)
        if (formData) {
          const obj: Record<string, string> = {}
          formData.forEach((value, key) => {
            obj[key] = String(value)
          })
          body = obj
        } else {
          body = {}
        }
      } else {
        body = await req.json().catch(() => ({}))
      }
      const parsed = UpdatePolicyBody.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      await database.updateNotificationPolicy({
        actorId: currentActor.id,
        ...parsed.data
      })

      const data = await buildPolicyResponse(database, currentActor.id)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)
