import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#rules
// This single-user/personal server does not define moderation rules, so the
// list is empty. Clients render an empty "Server rules" section gracefully.
export const GET = traceApiRoute('getInstanceRules', async (req) => {
  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
})
