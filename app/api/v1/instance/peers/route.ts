import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_500,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#peers
// Returns the list of remote domains this server has encountered (every domain
// stored on a remote actor record), excluding the local domain itself.
export const GET = traceApiRoute('getInstancePeers', async (req) => {
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

  const peers = await database.getInstancePeers({
    localDomain: getConfig().host
  })
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: peers,
    additionalHeaders: [['Cache-Control', 'public, max-age=3600']]
  })
})
