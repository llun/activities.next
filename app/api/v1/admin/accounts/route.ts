import { NextRequest } from 'next/server'
import { z } from 'zod'

import { listAdminAccountsResponse } from '@/lib/services/admin/listAdminAccountsResponse'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

// Mastodon v1 admin accounts filters. Booleans arrive as query strings, so use
// Booleanish; missing values are undefined (filter not applied).
const V1QueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  local: Booleanish.optional(),
  remote: Booleanish.optional(),
  active: Booleanish.optional(),
  pending: Booleanish.optional(),
  disabled: Booleanish.optional(),
  silenced: Booleanish.optional(),
  suspended: Booleanish.optional(),
  sensitized: Booleanish.optional(),
  staff: Booleanish.optional(),
  username: z.string().max(255).optional(),
  display_name: z.string().max(255).optional(),
  by_domain: z.string().max(255).optional(),
  email: z.string().max(255).optional(),
  ip: z.string().max(255).optional(),
  max_id: z.string().max(512).optional(),
  since_id: z.string().max(512).optional(),
  min_id: z.string().max(512).optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListAccounts',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database }) => {
      const queryParams = Object.fromEntries(new URL(req.url).searchParams)
      const parsed = V1QueryParams.safeParse(queryParams)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }
      const q = parsed.data
      // The cursors listAdminAccountsResponse emits are the account entity ids
      // (a UUIDv7 publicId, or the legacy urlToId form for a publicId-less
      // actor); a client sends one back as max_id/since_id/min_id, so resolve it
      // to the actor URI getAdminAccounts exact-matches against — pre-existing
      // bug: nothing ever decoded these, so pagination past page 1 never
      // matched a row.
      const [maxId, sinceId, minId] = await Promise.all([
        q.max_id ? resolveActorIdParam(database, q.max_id) : undefined,
        q.since_id ? resolveActorIdParam(database, q.since_id) : undefined,
        q.min_id ? resolveActorIdParam(database, q.min_id) : undefined
      ])

      return listAdminAccountsResponse({
        req,
        database,
        path: '/api/v1/admin/accounts',
        allowedMethods: CORS_HEADERS,
        params: {
          limit: q.limit,
          local: q.local,
          remote: q.remote,
          active: q.active,
          pending: q.pending,
          disabled: q.disabled,
          silenced: q.silenced,
          suspended: q.suspended,
          sensitized: q.sensitized,
          staff: q.staff,
          username: q.username,
          displayName: q.display_name,
          byDomain: q.by_domain,
          email: q.email,
          ip: q.ip,
          maxId,
          sinceId,
          minId
        }
      })
    },
    { resource: 'accounts' }
  )
)
