import { NextRequest } from 'next/server'
import { z } from 'zod'

import { applyDomainBlock } from '@/lib/actions/applyDomainBlock'
import { normalizeDomain } from '@/lib/services/federation/domainRules'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

// https://docs.joinmastodon.org/methods/domain_blocks/ — `limit` defaults to
// 100 and caps at 200 (clamped, not rejected, like Mastodon).
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

export const OPTIONS = defaultOptions(CORS_HEADERS)

const DomainBlocksQuery = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: clampedLimit(MAX_LIMIT, DEFAULT_LIMIT)
})

// `domain` column is varchar(255); normalizeDomain also rejects >255 chars.
const DomainBlockBody = z.object({
  domain: z.string().min(1).max(255)
})

// Mastodon documents `domain` as a form-data parameter for POST and DELETE;
// real clients also send it JSON-encoded or (for DELETE) in the query string.
// Returns the normalized hostname, or null when missing/invalid — the caller
// maps null to 422. User-level blocks target one exact domain, so the
// wildcard forms the admin-level normalizeDomain permits are rejected here.
const resolveDomain = async (req: NextRequest): Promise<string | null> => {
  const rawBody = await getRequestBody(req).catch(
    (): Record<string, unknown> => ({})
  )
  const url = new URL(req.url)
  const parsed = DomainBlockBody.safeParse({
    domain: rawBody.domain ?? url.searchParams.get('domain') ?? undefined
  })
  if (!parsed.success) return null

  const domain = normalizeDomain(parsed.data.domain)
  if (!domain || domain.includes('*')) return null
  return domain
}

export const GET = traceApiRoute(
  'getDomainBlocks',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:blocks']],
    async (req, { database, currentActor }) => {
      const url = new URL(req.url)
      const parsed = DomainBlocksQuery.safeParse(
        Object.fromEntries(url.searchParams.entries())
      )
      if (!parsed.success) return apiCorsError(req, CORS_HEADERS, 400)

      const {
        limit,
        max_id: maxId,
        min_id: minId,
        since_id: sinceId
      } = parsed.data

      const blocks = await database.getActorDomainBlocks({
        actorId: currentActor.id,
        limit,
        maxId,
        minId,
        sinceId
      })

      // Cursors are the underlying actor_domain_blocks row ids (the column
      // getActorDomainBlocks paginates on), matching the blocks route.
      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: '/api/v1/domain_blocks',
        limit,
        nextMaxId:
          blocks.length === limit ? blocks[blocks.length - 1].id : null,
        prevMinId: blocks.length > 0 ? blocks[0].id : null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: blocks.map((block) => block.domain),
        additionalHeaders
      })
    }
  )
)

export const POST = traceApiRoute(
  'createDomainBlock',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:blocks']],
    async (req, { database, currentActor }) => {
      const domain = await resolveDomain(req)
      if (!domain) return apiCorsError(req, CORS_HEADERS, 422)

      await applyDomainBlock({
        database,
        actorId: currentActor.id,
        domain
      })

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteDomainBlock',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:blocks']],
    async (req, { database, currentActor }) => {
      const domain = await resolveDomain(req)
      if (!domain) return apiCorsError(req, CORS_HEADERS, 422)

      // Idempotent per the Mastodon docs: succeeds even when not blocked.
      await database.deleteActorDomainBlock({
        actorId: currentActor.id,
        domain
      })

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
