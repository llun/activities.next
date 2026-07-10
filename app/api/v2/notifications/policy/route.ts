import { NextRequest } from 'next/server'
import { z } from 'zod'

import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import {
  getNotificationPolicyResponse,
  readNotificationPolicyBody
} from '@/lib/services/notifications/notificationPolicy'
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
  HttpMethod.enum.PUT,
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

export const GET = traceApiRoute(
  'getNotificationPolicy',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:notifications']],
    async (req, { currentActor, database }) => {
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const data = await getNotificationPolicyResponse(
        database,
        currentActor.id
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

export const PATCH = traceApiRoute(
  'updateNotificationPolicy',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:notifications']],
    async (req: NextRequest, { currentActor, database }) => {
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const body = await readNotificationPolicyBody(req)
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

      const data = await getNotificationPolicyResponse(
        database,
        currentActor.id
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

// Rails `resource :policy` maps update to both PUT and PATCH; some clients
// send PUT. Bind it to the same handler so it does not 405.
export const PUT = PATCH
