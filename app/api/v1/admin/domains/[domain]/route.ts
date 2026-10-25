import { NextRequest } from 'next/server'
import { z } from 'zod'

import {
  UpdateDomainRequest,
  hasIdentityOrPolicyFields
} from '@/app/api/v1/admin/domains/schema'
import {
  PRIMARY_DOMAIN_FEATURES_ERROR,
  PRIMARY_DOMAIN_IDENTITY_ERROR,
  readDomainRouteParam
} from '@/lib/services/domains/adminDomainTypes'
import {
  getAdminDomain,
  removeDomain,
  setDomainStatus,
  updateDomainSettings
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

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  contactEmail: 'Contact email',
  termsOfService: 'Terms of service',
  privacyPolicy: 'Privacy policy',
  allowedEmails: 'Allowed emails',
  disabledFeatures: 'Features'
}

// The first problem of a refused body, as a sentence the page can show. The
// `error` key stays the same as every other refusal; `field` names the input.
const describeInvalidRequest = (
  error: z.ZodError
): { field: string | null; message: string } => {
  const issue = error.issues[0]
  const key = issue?.path[0]
  const field = typeof key === 'string' ? key : null
  const label = field ? FIELD_LABELS[field] : undefined
  if (!issue || !field || !label) {
    return { field, message: issue?.message ?? ERROR_422.error }
  }
  if (field === 'contactEmail' && issue.code === 'invalid_format') {
    return { field, message: 'Enter a valid contact email address.' }
  }
  if (issue.code === 'too_big' && issue.origin === 'array') {
    return {
      field,
      message: `${label} has too many addresses (at most ${String(issue.maximum)}).`
    }
  }
  if (issue.code === 'too_big') {
    return {
      field,
      message: `${label} is too long (at most ${String(issue.maximum)} characters).`
    }
  }
  if (issue.code === 'too_small') {
    return { field, message: `${label} cannot be blank.` }
  }
  return { field, message: `${label} is not valid.` }
}

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
      const { field, message } = describeInvalidRequest(parsed.error)
      return failure(
        req,
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        'invalid',
        message,
        field ? { field } : {}
      )
    }

    const { status, ...settings } = parsed.data
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

    const result = await updateDomainSettings(database, domain, settings)
    switch (result.type) {
      case 'not-found':
        return notFound(req)
      case 'primary':
        return failure(
          req,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          'primary',
          parsed.data.disabledFeatures !== undefined
            ? PRIMARY_DOMAIN_FEATURES_ERROR
            : hasIdentityOrPolicyFields(parsed.data)
              ? PRIMARY_DOMAIN_IDENTITY_ERROR
              : 'The primary domain’s sign-ups are set in Admin › Server settings.'
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
