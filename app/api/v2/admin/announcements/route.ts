import { NextRequest } from 'next/server'

import {
  AnnouncementCreateInput,
  getAdminAnnouncement,
  isoToStorageTime
} from '@/lib/services/announcements/adminAnnouncement'
import {
  domainScopeErrorBody,
  resolveAdminDomainScope
} from '@/lib/services/domains/domainScope'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
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

// GET lists every announcement, newest first. `?domain=<served domain>` (an
// extension) narrows it to the announcements shown on that domain only, without
// the every-domain ones.
export const GET = traceApiRoute(
  'adminListAnnouncements',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const raw = new URL(req.url).searchParams.get('domain')
    const scope = raw
      ? await resolveAdminDomainScope(database, raw, { allowPrimary: true })
      : null
    if (scope && scope.type !== 'ok') return scopeError(req, scope.type)
    const announcements = await database.getAnnouncements(
      scope?.domain ? { domain: scope.domain } : {}
    )
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: announcements.map(getAdminAnnouncement)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateAnnouncement',
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
    const parsed = AnnouncementCreateInput.safeParse(rawBody)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const scope = await resolveAdminDomainScope(database, parsed.data.domain, {
      allowPrimary: true
    })
    if (scope.type !== 'ok') return scopeError(req, scope.type)

    const announcement = await database.createAnnouncement({
      domain: scope.domain,
      text: parsed.data.text,
      startsAt: isoToStorageTime(parsed.data.starts_at) ?? null,
      endsAt: isoToStorageTime(parsed.data.ends_at) ?? null,
      allDay: parsed.data.all_day,
      published: parsed.data.published
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getAdminAnnouncement(announcement)
    })
  })
)
