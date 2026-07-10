import { NextRequest } from 'next/server'
import { z } from 'zod'

import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import {
  getNotificationPolicyResponse,
  readNotificationPolicyBody,
  toV1NotificationPolicy
} from '@/lib/services/notifications/notificationPolicy'
import {
  NotificationPolicy,
  NotificationPolicyValue,
  Scope
} from '@/lib/types/database/operations'
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

// Mastodon casts the legacy booleans with ActiveModel::Type::Boolean: a fixed
// set of false tokens, everything else true.
const FALSE_TOKENS = new Set(['false', 'f', '0', 'off', ''])

const LegacyBoolean = z
  .union([z.boolean(), z.number(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    return !FALSE_TOKENS.has(value.toLowerCase())
  })

const UpdateLegacyPolicyBody = z.object({
  filter_not_following: LegacyBoolean.optional(),
  filter_not_followers: LegacyBoolean.optional(),
  filter_new_accounts: LegacyBoolean.optional(),
  filter_private_mentions: LegacyBoolean.optional()
})

const LEGACY_TO_POLICY_KEY = [
  ['filter_not_following', 'for_not_following'],
  ['filter_not_followers', 'for_not_followers'],
  ['filter_new_accounts', 'for_new_accounts'],
  ['filter_private_mentions', 'for_private_mentions']
] as const

// https://docs.joinmastodon.org/methods/notifications/ (deprecated section)
// The pre-4.3 beta filtered-notifications API. It reads and writes the same
// stored policy as /api/v2/notifications/policy but serializes filter_*
// booleans instead of the v2 for_* accept/filter/drop strings.
export const GET = traceApiRoute(
  'getNotificationPolicyV1',
  OAuthGuard([Scope.enum.read], async (req, { currentActor, database }) => {
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const data = toV1NotificationPolicy(
      await getNotificationPolicyResponse(database, currentActor.id)
    )
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  })
)

const updatePolicyV1 = OAuthGuard(
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

    const body = await readNotificationPolicyBody(req)
    const parsed = UpdateLegacyPolicyBody.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    // Only forward keys the client actually sent: updateNotificationPolicy
    // spreads the partial over the stored policy, so an explicit undefined
    // would clobber a stored value.
    const updates: Partial<NotificationPolicy> = {}
    for (const [legacyKey, policyKey] of LEGACY_TO_POLICY_KEY) {
      const value = parsed.data[legacyKey]
      if (value === undefined) continue
      updates[policyKey] = value
        ? NotificationPolicyValue.enum.filter
        : NotificationPolicyValue.enum.accept
    }

    await database.updateNotificationPolicy({
      actorId: currentActor.id,
      ...updates
    })

    const data = toV1NotificationPolicy(
      await getNotificationPolicyResponse(database, currentActor.id)
    )
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  }
)

// Rails maps `update` to both verbs; pre-4.3 clients use PUT.
export const PUT = traceApiRoute('updateNotificationPolicyV1', updatePolicyV1)
export const PATCH = traceApiRoute(
  'updateNotificationPolicyV1Patch',
  updatePolicyV1
)
