import { NextRequest } from 'next/server'

import { getOAuth2Server } from '@/lib/services/oauth/server'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getQueryParams } from '@/lib/utils/getQueryParams'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { StatusCode, apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = async (req: NextRequest) => {
  const server = await getOAuth2Server()

  const query = getQueryParams(req)
  const body = await getRequestBody(req)

  const request = {
    headers: Object.fromEntries(req.headers.entries()),
    query,
    body
  }
  const oauthResponse = await server.respondToAccessTokenRequest(request)
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      ...oauthResponse.body,
      created_at: Math.floor(Date.now() / 1000)
    },
    responseStatusCode: oauthResponse.status as StatusCode
  })
}
