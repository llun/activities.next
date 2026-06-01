import { NextRequest } from 'next/server'

import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// https://docs.joinmastodon.org/methods/scheduled_statuses/
// Scheduling is not supported (statuses publish immediately), so no scheduled
// status can ever be found by id.
const notFound = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_404,
    responseStatusCode: 404
  })

export const GET = traceApiRoute(
  'getScheduledStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req) => notFound(req)
  )
)

export const PUT = traceApiRoute(
  'updateScheduledStatus',
  OAuthGuard<Params>([Scope.enum['write:statuses']], async (req) =>
    notFound(req)
  )
)

export const DELETE = traceApiRoute(
  'deleteScheduledStatus',
  OAuthGuard<Params>([Scope.enum['write:statuses']], async (req) =>
    notFound(req)
  )
)
