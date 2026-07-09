import { NextRequest } from 'next/server'
import { z } from 'zod'

import { DomainBlockRequest } from '@/app/api/v1/admin/domain_blocks/schema'
import {
  isDomainBlockStricter,
  normalizeDomain,
  toAdminDomainBlock
} from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import {
  ERROR_400,
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
const DomainRuleListQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  max_id: z.string().max(255).optional(),
  since_id: z.string().max(255).optional(),
  min_id: z.string().max(255).optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomainBlocks',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database }) => {
      const queryParams = Object.fromEntries(new URL(req.url).searchParams)
      const parsedParams = DomainRuleListQueryParams.safeParse(queryParams)
      if (!parsedParams.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }

      const {
        limit,
        offset,
        max_id: maxId,
        since_id: sinceId,
        min_id: minId
      } = parsedParams.data
      const hasCursor = Boolean(maxId || sinceId || minId)
      const [blocks, stats] = await Promise.all([
        database.getDomainBlocks({ limit, offset, maxId, minId, sinceId }),
        database.getDomainFederationRuleStats()
      ])

      const additionalHeaders: [string, string][] = [
        ...buildPaginationLinkHeader({
          host: headerHost(req.headers),
          path: '/api/v1/admin/domain_blocks',
          limit,
          nextMaxId:
            blocks.length === limit ? blocks[blocks.length - 1].id : null,
          prevMinId: blocks.length > 0 ? blocks[0].id : null
        }),
        // The offset/X-Total-Count listing is kept as an extension for the
        // admin UI when no cursor parameter is used.
        ...(hasCursor
          ? []
          : ([
              ['X-Total-Count', `${stats.blocks}`],
              ['X-Offset', `${offset}`],
              ['X-Limit', `${limit}`]
            ] as [string, string][]))
      ]

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: blocks.map(toAdminDomainBlock),
        additionalHeaders
      })
    },
    { resource: 'domain_blocks' }
  )
)

export const POST = traceApiRoute(
  'adminCreateDomainBlock',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database }) => {
      let data: unknown
      try {
        data = await getRequestBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }

      const parsed = DomainBlockRequest.safeParse(data)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      // Mastodon 422s when the domain (or a covering wildcard rule) is already
      // blocked and the new block is not stricter, echoing the existing rule so
      // admin UIs can offer an update instead of silently upserting.
      const normalizedDomain = normalizeDomain(parsed.data.domain)
      const existing = normalizedDomain
        ? await database.getDomainBlockForDomain(normalizedDomain)
        : null
      if (
        existing &&
        (existing.domain === normalizedDomain ||
          !isDomainBlockStricter(
            {
              severity: parsed.data.severity,
              rejectMedia: parsed.data.reject_media,
              rejectReports: parsed.data.reject_reports
            },
            existing
          ))
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            error: 'That domain has already been blocked',
            existing_domain_block: toAdminDomainBlock(existing)
          },
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      const block = await database.createDomainBlock({
        domain: parsed.data.domain,
        severity: parsed.data.severity,
        rejectMedia: parsed.data.reject_media,
        rejectReports: parsed.data.reject_reports,
        privateComment: parsed.data.private_comment,
        publicComment: parsed.data.public_comment,
        obfuscate: parsed.data.obfuscate,
        source: null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toAdminDomainBlock(block)
      })
    },
    { resource: 'domain_blocks' }
  )
)
