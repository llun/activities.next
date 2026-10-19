import { NextRequest } from 'next/server'

import { UpdateDomainRequest } from '@/app/api/v1/admin/domains/schema'
import { readDomainRouteParam } from '@/lib/services/domains/adminDomainTypes'
import {
  getAdminDomain,
  removeDomain,
  setDomainStatus,
  updateDomainRegistrations
} from '@/lib/services/domains/adminDomains'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { normalizeServedDomainChoice } from '@/lib/utils/host'
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

type Params = { domain: string }

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const notFound = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_404,
    responseStatusCode: HTTP_STATUS.NOT_FOUND
  })

const failure = (
  req: NextRequest,
  status: (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS],
  code: string,
  error: string,
  extra: Record<string, unknown> = {}
) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error, code, ...extra },
    responseStatusCode: status
  })

const readDomain = async (params: Promise<Params>) =>
  normalizeServedDomainChoice(readDomainRouteParam((await params).domain))

export const GET = traceApiRoute(
  'adminGetDomain',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const domain = await readDomain(params)
    const item = domain ? await getAdminDomain(database, domain) : null
    if (!item) return notFound(req)
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: item })
  })
)

export const PATCH = traceApiRoute(
  'adminUpdateDomain',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const domain = await readDomain(params)
    if (!domain) return notFound(req)

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
    const parsed = UpdateDomainRequest.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const { status, ...registrations } = parsed.data
    if (status) {
      const result = await setDomainStatus(database, domain, status)
      switch (result.type) {
        case 'not-found':
          return notFound(req)
        case 'locked':
          return failure(
            req,
            HTTP_STATUS.UNPROCESSABLE_ENTITY,
            'locked',
            'This domain is set in the environment and is always on.'
          )
        case 'check-failed':
          return failure(
            req,
            HTTP_STATUS.CONFLICT,
            'check-failed',
            'The domain did not pass the check, so it stays off.',
            { domain: result.domain }
          )
        case 'updated':
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: result.domain
          })
      }
    }

    const result = await updateDomainRegistrations(
      database,
      domain,
      registrations
    )
    switch (result.type) {
      case 'not-found':
        return notFound(req)
      case 'primary':
        return failure(
          req,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          'primary',
          'The primary domain’s sign-ups are set in Admin › Instance.'
        )
      case 'updated':
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: result.domain
        })
    }
  })
)

export const DELETE = traceApiRoute(
  'adminRemoveDomain',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const domain = await readDomain(params)
    if (!domain) return notFound(req)

    const result = await removeDomain(database, domain)
    switch (result.type) {
      case 'not-found':
        return notFound(req)
      case 'locked':
        return failure(
          req,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          'locked',
          'This domain is set in the environment and cannot be removed here.'
        )
      case 'on':
        return failure(
          req,
          HTTP_STATUS.CONFLICT,
          'on',
          'Turn the domain off before removing it.'
        )
      case 'has-profiles':
        return failure(
          req,
          HTTP_STATUS.CONFLICT,
          'has-profiles',
          'Profiles still use this domain, so it can only be turned off.'
        )
      case 'removed':
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { domain }
        })
    }
  })
)
