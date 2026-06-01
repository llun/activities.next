import { getConfig } from '@/lib/config'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

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
        // The description is wrapped in HTML; escape it so special characters
        // can't produce malformed markup.
        content: `<p>${escapeHtml(content)}</p>`
      }
    })
  }
)
