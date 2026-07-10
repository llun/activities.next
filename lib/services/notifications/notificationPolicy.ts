import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { NotificationPolicy } from '@/lib/types/database/operations'

export interface NotificationPolicySummary {
  pending_requests_count: number
  pending_notifications_count: number
}

export type NotificationPolicyResponse = NotificationPolicy & {
  summary: NotificationPolicySummary
}

// Shared by GET/PATCH /api/v2/notifications/policy and the deprecated
// GET/PUT/PATCH /api/v1/notifications/policy alias.
export const getNotificationPolicyResponse = async (
  database: Database,
  actorId: string
): Promise<NotificationPolicyResponse> => {
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

// The deprecated v1 beta entity (Mastodon's
// REST::V1::NotificationPolicySerializer) reports filter_* booleans — true
// for anything other than accept — instead of the v2 accept/filter/drop
// strings, and never included for_limited_accounts. The summary object is
// present in both versions.
export const toV1NotificationPolicy = (
  response: NotificationPolicyResponse
) => ({
  filter_not_following: response.for_not_following !== 'accept',
  filter_not_followers: response.for_not_followers !== 'accept',
  filter_new_accounts: response.for_new_accounts !== 'accept',
  filter_private_mentions: response.for_private_mentions !== 'accept',
  summary: response.summary
})

// Mastodon accepts the policy update as JSON or form-encoded; normalize both
// to a plain object for Zod. A request with no (or an unrecognized)
// content-type is treated as JSON so a bodyless/typeless PATCH still resolves
// to {} — this mirrors the original inline v2 reader that clients rely on.
export const readNotificationPolicyBody = async (
  req: NextRequest
): Promise<unknown> => {
  const contentType = req.headers.get('content-type') ?? ''

  // Parse urlencoded bodies with URLSearchParams rather than req.formData():
  // unlike formData(), it works on the synthetic request bodies used in tests
  // (see lib/utils/getRequestBody.ts).
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(await req.text()))
  }

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData().catch(() => null)
    if (!formData) return {}

    const body: Record<string, string> = {}
    formData.forEach((value, key) => {
      body[key] = String(value)
    })
    return body
  }

  return req.json().catch(() => ({}))
}
