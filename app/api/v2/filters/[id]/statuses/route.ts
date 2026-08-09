import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseStatusCreateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import {
  getMastodonFilterStatusWithPublicId,
  getMastodonFilterStatuses
} from '@/lib/services/mastodon/getMastodonFilter'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
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
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'listFilterStatuses',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const statuses = await database.getFilterStatuses({
        actorId: currentActor.id,
        filterId: id
      })
      if (!statuses)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getMastodonFilterStatuses(database, statuses)
      })
    }
  )
)

export const POST = traceApiRoute(
  'addFilterStatus',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req: NextRequest, { database, currentActor, params }) => {
      const { id } = await params
      let rawBody: unknown
      try {
        rawBody = await parseFilterBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }
      const suppliedStatusId = parseStatusCreateInput(rawBody)
      if (!suppliedStatusId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      // parseStatusCreateInput validates the shape only, so resolve the client
      // id form here like every other status-id-accepting write route. Matching
      // covers a bare publicId too, but only the resolved URI is stable: it is
      // the key the emission side resolves a publicId back FROM, so a row stored
      // in any other form can only be echoed in the form it was written in.
      // Legacy colon-form and raw-URI input both resolve to that same URI, and
      // rows already stored in either form keep matching untouched.
      const statusId = await resolveStatusIdParam(database, suppliedStatusId)

      const filterStatus = await database.addFilterStatus({
        actorId: currentActor.id,
        filterId: id,
        statusId
      })
      if (!filterStatus)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getMastodonFilterStatusWithPublicId(database, filterStatus)
      })
    }
  )
)
