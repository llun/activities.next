import { NextRequest } from 'next/server'
import { z } from 'zod'

import { applyAdminAccountAction } from '@/lib/services/admin/applyAdminAccountAction'
import { resolveAdminAccountRecord } from '@/lib/services/admin/serializeAdminAccounts'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

// Mastodon's account action `type` set. warning_preset_id/send_email_notification
// are accepted and ignored (no presets/moderation-mail subsystems).
const ActionRequest = z.object({
  type: z.enum(['none', 'disable', 'sensitive', 'silence', 'suspend']),
  report_id: z.string().max(255).optional(),
  warning_preset_id: z.string().max(255).optional(),
  text: z.string().max(2000).optional(),
  send_email_notification: z.union([z.boolean(), z.string()]).optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

type Params = { id: string }

export const POST = traceApiRoute(
  'adminAccountAction',
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

      const parsed = ActionRequest.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      const record = await resolveAdminAccountRecord(database, id)
      if (!record) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      const result = await applyAdminAccountAction({
        database,
        record,
        action: parsed.data.type,
        moderator,
        reportId: parsed.data.report_id ?? null,
        text: parsed.data.text ?? ''
      })
      if (!result.ok) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: result.error },
          responseStatusCode: result.status
        })
      }

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    },
    { resource: 'accounts' }
  )
)
