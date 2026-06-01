import { getConfig } from '@/lib/config'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#extended_description
export const GET = traceApiRoute(
  'getInstanceExtendedDescription',
  async (req) => {
    const config = getConfig()
    const content =
      config.serviceDescription ?? 'Personal activity pub server with Next.js'
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        updated_at: new Date(0).toISOString(),
        content: `<p>${content}</p>`
      }
    })
  }
)
