import { NextRequest } from 'next/server'

import {
  domainScopeErrorBody,
  resolveAdminDomainScope
} from '@/lib/services/domains/domainScope'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { RuleCreateInput, getAdminRule } from '@/lib/services/rules/adminRule'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const scopeError = (
  req: NextRequest,
  type: 'invalid' | 'unknown' | 'primary'
) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: domainScopeErrorBody(type),
    responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
  })

// GET lists one scope in position order: the server rules, or, with
// `?domain=<served domain>`, that domain's own rules (an extension: Mastodon
// has no per-domain rules). The primary has none of its own: asking for it is a
// 422.
export const GET = traceApiRoute(
  'adminListInstanceRules',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const scope = await resolveAdminDomainScope(
      database,
      new URL(req.url).searchParams.get('domain'),
      { allowPrimary: false }
    )
    if (scope.type !== 'ok') return scopeError(req, scope.type)
    const rules = await database.getOwnInstanceRules({ domain: scope.domain })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: rules.map(getAdminRule)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateInstanceRule',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }
    const parsed = RuleCreateInput.safeParse(rawBody)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const scope = await resolveAdminDomainScope(database, parsed.data.domain, {
      allowPrimary: false
    })
    if (scope.type !== 'ok') return scopeError(req, scope.type)

    const rule = await database.createInstanceRule({
      domain: scope.domain,
      text: parsed.data.text,
      hint: parsed.data.hint,
      position: parsed.data.position
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getAdminRule(rule)
    })
  })
)
