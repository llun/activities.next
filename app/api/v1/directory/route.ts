import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit, clampedOffset } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const DirectoryParams = z.object({
  offset: clampedOffset(),
  limit: clampedLimit(80, 40),
  order: z.enum(['active', 'new']).default('active'),
  // Mastodon semantics: local=true restricts the listing to this server's
  // accounts; the default directory includes known remote actors. Booleanish
  // coerces the string param and treats garbage as false instead of 400ing.
  local: Booleanish.default(false)
})

// https://docs.joinmastodon.org/methods/directory/
// Lists known profiles: every actor this server has seen by default, or only
// this server's own accounts when local=true.
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

    const { offset, limit, order, local } = parsed.data
    const actors = await database.getLocalMastodonActors({
      localDomain: getConfig().host,
      limit,
      offset,
      order,
      local
    })

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: actors })
  })
)
