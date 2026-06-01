import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const DirectoryParams = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(80).default(40),
  order: z.enum(['active', 'new']).default('active'),
  local: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
})

// https://docs.joinmastodon.org/methods/directory/
// Lists the local profiles hosted on this server. Remote-only directories are
// not maintained, so the `local` parameter is accepted but the listing is always
// the local actors.
export const GET = traceApiRoute(
  'getDirectory',
  OptionalOAuthGuard([Scope.enum.read], async (req, { database }) => {
    const url = new URL(req.url)
    const parsed = DirectoryParams.safeParse(
      Object.fromEntries(url.searchParams)
    )
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const { offset, limit, order } = parsed.data
    const actors = await database.getLocalMastodonActors({
      localDomain: getConfig().host,
      limit,
      offset,
      order
    })

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: actors })
  })
)
