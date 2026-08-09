import { NextRequest } from 'next/server'
import { z } from 'zod'

import { listAdminAccountsResponse } from '@/lib/services/admin/listAdminAccountsResponse'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { GetAdminAccountsParams } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

// Mastodon v2 admin accounts filters. `origin`/`status`/`permissions` map onto
// the same underlying predicates as the v1 booleans.
const V2QueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  origin: z.enum(['local', 'remote']).optional(),
  status: z
    .enum(['active', 'pending', 'disabled', 'silenced', 'suspended'])
    .optional(),
  permissions: z.enum(['staff']).optional(),
  username: z.string().max(255).optional(),
  display_name: z.string().max(255).optional(),
  by_domain: z.string().max(255).optional(),
  email: z.string().max(255).optional(),
  ip: z.string().max(255).optional(),
  max_id: z.string().max(512).optional(),
  since_id: z.string().max(512).optional(),
  min_id: z.string().max(512).optional(),
  // No roles/invites subsystems: any request scoped by these filters can never
  // match, so it deliberately returns an empty page (documented, not an error).
  invited_by: z.string().max(512).optional(),
  'role_ids[]': z.union([z.string(), z.array(z.string())]).optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListAccountsV2',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database }) => {
      const url = new URL(req.url)
      const queryParams: Record<string, unknown> = Object.fromEntries(
        url.searchParams
      )
      const roleIds = url.searchParams.getAll('role_ids[]')
      if (roleIds.length > 0) queryParams['role_ids[]'] = roleIds

      const parsed = V2QueryParams.safeParse(queryParams)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }
      const q = parsed.data

      // role_ids[]/invited_by can never match — short-circuit to empty.
      const hasRoleId = Array.isArray(q['role_ids[]'])
        ? q['role_ids[]'].length > 0
        : Boolean(q['role_ids[]'])
      if (hasRoleId || q.invited_by) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

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

      const params: GetAdminAccountsParams = {
        limit: q.limit,
        local: q.origin === 'local' ? true : undefined,
        remote: q.origin === 'remote' ? true : undefined,
        active: q.status === 'active' ? true : undefined,
        pending: q.status === 'pending' ? true : undefined,
        disabled: q.status === 'disabled' ? true : undefined,
        silenced: q.status === 'silenced' ? true : undefined,
        suspended: q.status === 'suspended' ? true : undefined,
        staff: q.permissions === 'staff' ? true : undefined,
        username: q.username,
        displayName: q.display_name,
        byDomain: q.by_domain,
        email: q.email,
        ip: q.ip,
        maxId,
        sinceId,
        minId
      }

      return listAdminAccountsResponse({
        req,
        database,
        path: '/api/v2/admin/accounts',
        allowedMethods: CORS_HEADERS,
        params
      })
    },
    { resource: 'accounts' }
  )
)
