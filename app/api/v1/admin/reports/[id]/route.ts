import { NextRequest } from 'next/server'
import { z } from 'zod'

import { serializeAdminReports } from '@/lib/services/admin/serializeAdminReports'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { ReportCategory } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT
]

type Params = { id: string }

const UpdateRequest = z.object({
  category: ReportCategory.optional(),
  rule_ids: z
    .union([z.array(z.string()), z.string()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminGetReport',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params, moderator }) => {
      const { id } = await params
      const report = await database.getReportById({ reportId: id })
      if (!report) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }
      const [entity] = await serializeAdminReports(
        database,
        [report],
        moderator.actorId ?? undefined
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
    },
    { resource: 'reports' }
  )
)

export const PUT = traceApiRoute(
  'adminUpdateReport',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params, moderator }) => {
      const { id } = await params

      let body: unknown
      try {
        body = await getRequestBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }
      const parsed = UpdateRequest.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      const existing = await database.getReportById({ reportId: id })
      if (!existing) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      // rule_ids referencing unknown rules are a 422 (Mastodon parity).
      if (parsed.data.rule_ids) {
        const knownRuleIds = new Set(
          (await database.getInstanceRules()).map((rule) => rule.id)
        )
        const hasUnknown = parsed.data.rule_ids.some(
          (ruleId) => !knownRuleIds.has(ruleId)
        )
        if (hasUnknown) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'Unknown rule id' },
            responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
          })
        }
      }

      const updated = await database.updateReportCategory({
        reportId: id,
        category: parsed.data.category,
        ruleIds: parsed.data.rule_ids
      })
      const [entity] = updated
        ? await serializeAdminReports(
            database,
            [updated],
            moderator.actorId ?? undefined
          )
        : []
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
    },
    { resource: 'reports' }
  )
)
