import { getDatabase } from '@/lib/database'
import { Rule } from '@/lib/types/mastodon/rule'
import { HttpMethod } from '@/lib/utils/http-headers'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#rules
// Public, unauthenticated — Mastodon serves GET /api/v1/instance/rules without
// a token. Rules are stored in the database ordered by position.
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

  const rules = await database.getInstanceRules()
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: rules.map((rule) =>
      Rule.parse({ id: rule.id, text: rule.text, hint: rule.hint })
    )
  })
})
