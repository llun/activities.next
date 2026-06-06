import { z } from 'zod'

import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { ReportCategory, Scope } from '@/lib/types/database/operations'
import { getMastodonTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const CreateReportBody = z.object({
  account_id: z.string().min(1),
  status_ids: z
    .union([z.array(z.string().min(1)), z.string().min(1)])
    .optional(),
  comment: z.string().max(1000).optional(),
  forward: z.coerce.boolean().optional(),
  category: ReportCategory.optional(),
  rule_ids: z.union([z.array(z.string().min(1)), z.string().min(1)]).optional()
})

const toArray = (value: string[] | string | undefined): string[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

// https://docs.joinmastodon.org/methods/reports/#post
export const POST = traceApiRoute(
  'createReport',
  OAuthGuard(
    [Scope.enum['write:reports']],
    async (req, { database, currentActor }) => {
      const json = await req.json().catch(() => null)
      const parsed = CreateReportBody.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const targetActorId = idToUrl(parsed.data.account_id)
      const targetAccount = await database.getMastodonActorFromId({
        id: targetActorId
      })
      if (!targetAccount) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const statusIds = toArray(parsed.data.status_ids).map((id) => idToUrl(id))
      const ruleIds = toArray(parsed.data.rule_ids)

      const report = await database.createReport({
        actorId: currentActor.id,
        targetActorId,
        category: parsed.data.category,
        comment: parsed.data.comment ?? '',
        forward: parsed.data.forward ?? false,
        statusIds,
        ruleIds
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          id: report.id,
          action_taken: report.actionTaken,
          action_taken_at: null,
          category: report.category,
          comment: report.comment,
          forwarded: report.forward,
          created_at: getMastodonTimeUTC(report.createdAt),
          // Echo ids back in the Mastodon short form clients sent, not the
          // internal URL form we persist.
          status_ids: report.statusIds.map((id) => urlToId(id)),
          rule_ids: report.ruleIds,
          target_account: targetAccount
        }
      })
    }
  )
)
