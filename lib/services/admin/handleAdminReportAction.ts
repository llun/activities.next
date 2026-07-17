import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { serializeAdminReports } from '@/lib/services/admin/serializeAdminReports'
import { AdminModerator } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, HTTP_STATUS, apiResponse } from '@/lib/utils/response'

export type AdminReportAction =
  'assign_to_self' | 'unassign' | 'resolve' | 'reopen'

// Shared handler for the report workflow endpoints. Resolves the report,
// applies the action, audit-logs it (action 'none', linked to the report),
// and returns the refreshed Admin::Report.
export const handleAdminReportAction = async ({
  req,
  database,
  reportId,
  moderator,
  action,
  allowedMethods
}: {
  req: NextRequest
  database: Database
  reportId: string
  moderator: AdminModerator
  action: AdminReportAction
  allowedMethods: HttpMethod[]
}): Promise<Response> => {
  const report = await database.getReportById({ reportId })
  if (!report) {
    return apiResponse({
      req,
      allowedMethods,
      data: ERROR_404,
      responseStatusCode: HTTP_STATUS.NOT_FOUND
    })
  }

  if (action === 'assign_to_self' && !moderator.actorId) {
    // The cookie-session admin resolved no actor to assign.
    return apiResponse({
      req,
      allowedMethods,
      data: { error: 'Admin account has no actor' },
      responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
    })
  }

  switch (action) {
    case 'assign_to_self':
      await database.assignReport({
        reportId,
        assignedActorId: moderator.actorId
      })
      break
    case 'unassign':
      await database.assignReport({ reportId, assignedActorId: null })
      break
    case 'resolve':
      await database.setReportResolution({
        reportId,
        resolved: true,
        actionTakenByActorId: moderator.actorId
      })
      break
    case 'reopen':
      await database.setReportResolution({ reportId, resolved: false })
      break
  }

  await database.createModerationAction({
    targetActorId: report.targetActorId,
    moderatorAccountId: moderator.accountId ?? '',
    moderatorActorId: moderator.actorId,
    action: 'none',
    reportId
  })

  const refreshed = await database.getReportById({ reportId })
  const [entity] = refreshed
    ? await serializeAdminReports(
        database,
        [refreshed],
        moderator.actorId ?? undefined
      )
    : []
  return apiResponse({ req, allowedMethods, data: entity })
}
