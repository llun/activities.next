import { getDatabase } from '@/lib/database'
import { getRulesForHost } from '@/lib/services/domains/domainAudience'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Rule } from '@/lib/types/mastodon/rule'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#rules
// Public, unauthenticated — Mastodon serves GET /api/v1/instance/rules without
// a token. Rules are stored in the database ordered by position. On the
// visited host the list is the server rules followed by that domain's own rules
// (an extension: Mastodon has one rule list per server); ids are unique.
export const GET = traceApiRoute('getInstanceRules', async (req) => {
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'Database unavailable' },
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

  let rules
  try {
    // Refresh first: `headerHost` trusts the visited host from the snapshot.
    await ensureServedDomainsFresh()
    rules = await getRulesForHost(database, headerHost(req.headers))
  } catch (error) {
    // A query failure (timeout, lock, etc.) must return structured JSON like
    // the database-unavailable branch above, not let Next.js emit a non-JSON
    // 500 that Mastodon clients expecting JSON can't parse.
    logger.warn({
      message: 'Failed to load instance rules for /api/v1/instance/rules',
      error: error instanceof Error ? error.message : String(error)
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'Failed to load rules' },
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: rules.map((rule): Rule => ({
      id: rule.id,
      text: rule.text,
      hint: rule.hint
    }))
  })
})
