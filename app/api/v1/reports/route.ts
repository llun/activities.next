import { z } from 'zod'

import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { ReportCategory, Scope } from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const CreateReportBody = z.object({
  account_id: z.string().min(1),
  status_ids: z
    .union([z.array(z.string().min(1)), z.string().min(1)])
    .optional(),
  comment: z.string().max(1000).optional(),
  forward: Booleanish.optional(),
  category: ReportCategory.optional(),
  rule_ids: z.union([z.array(z.string().min(1)), z.string().min(1)]).optional()
})

const toArray = (value: string[] | string | undefined): string[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

const collectStrings = (values: unknown[]): string[] =>
  values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )

// Build the report object from a form/multipart source. status_ids and rule_ids
// arrive as bracket arrays (status_ids[]=…); everything else is scalar. The Zod
// schema then coerces (forward via Booleanish, category via the enum).
const buildFormReport = (
  get: (name: string) => unknown,
  getAll: (name: string) => unknown[]
) => {
  const scalar = (name: string) => {
    const value = get(name)
    return typeof value === 'string' ? value : undefined
  }
  const statusIds = collectStrings(getAll('status_ids[]'))
  const ruleIds = collectStrings(getAll('rule_ids[]'))
  return {
    account_id: scalar('account_id'),
    status_ids: statusIds.length > 0 ? statusIds : scalar('status_ids'),
    comment: scalar('comment'),
    forward: scalar('forward'),
    category: scalar('category'),
    rule_ids: ruleIds.length > 0 ? ruleIds : scalar('rule_ids')
  }
}

// Accepts JSON, urlencoded, and multipart report bodies.
const parseReportBody = async (req: Request): Promise<unknown> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await req.text())
    return buildFormReport(
      (name) => params.get(name),
      (name) => params.getAll(name)
    )
  }
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    return buildFormReport(
      (name) => form.get(name),
      (name) => form.getAll(name)
    )
  }
  return req.json()
}

// https://docs.joinmastodon.org/methods/reports/#post
export const POST = traceApiRoute(
  'createReport',
  OAuthGuard(
    [Scope.enum['write:reports']],
    async (req, { database, currentActor }) => {
      const json = await parseReportBody(req).catch(() => null)
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
          created_at: getISOTimeUTC(report.createdAt),
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
