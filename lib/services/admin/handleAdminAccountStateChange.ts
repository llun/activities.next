import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { applyAdminAccountAction } from '@/lib/services/admin/applyAdminAccountAction'
import {
  hydrateAdminAccounts,
  resolveAdminAccountRecord
} from '@/lib/services/admin/serializeAdminAccounts'
import { AdminModerator } from '@/lib/services/guards/AdminApiGuard'
import { ModerationActionType } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse } from '@/lib/utils/response'

// Shared handler for the reverse/state-change account endpoints (approve,
// reject, enable, unsilence, unsuspend, unsensitive). Resolves the target,
// applies the action (which audit-logs), and returns the refreshed
// Admin::Account — except `reject`, which deletes the account, so its
// pre-deletion snapshot is serialized and returned instead.
export const handleAdminAccountStateChange = async ({
  req,
  database,
  id,
  moderator,
  action,
  allowedMethods
}: {
  req: NextRequest
  database: Database
  id: string
  moderator: AdminModerator
  action: ModerationActionType
  allowedMethods: HttpMethod[]
}): Promise<Response> => {
  const record = await resolveAdminAccountRecord(database, id)
  if (!record) {
    return apiResponse({
      req,
      allowedMethods,
      data: ERROR_404,
      responseStatusCode: 404
    })
  }

  // reject deletes the account+actor, so serialize the entity before mutating.
  const preSnapshot =
    action === 'reject'
      ? (await hydrateAdminAccounts(database, [record]))[0]
      : null

  const result = await applyAdminAccountAction({
    database,
    record,
    action,
    moderator
  })
  if (!result.ok) {
    return apiResponse({
      req,
      allowedMethods,
      data: { error: result.error },
      responseStatusCode: result.status
    })
  }

  if (preSnapshot) {
    return apiResponse({ req, allowedMethods, data: preSnapshot })
  }

  const refreshed = await resolveAdminAccountRecord(database, id)
  const [entity] = refreshed
    ? await hydrateAdminAccounts(database, [refreshed])
    : []
  return apiResponse({ req, allowedMethods, data: entity })
}
