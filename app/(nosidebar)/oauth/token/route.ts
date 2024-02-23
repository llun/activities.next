import { NextRequest } from 'next/server'

import { getOAuth2Server } from '@/lib/services/oauth/server'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { StatusCode, apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = async (req: NextRequest) => {
  const server = await getOAuth2Server()

  const url = new URL(req.url)
  const query = Object.fromEntries(url.searchParams.entries())
  const form = await req.formData()
  const body = Object.fromEntries(form.entries())
  const request = {
    headers: Object.fromEntries(req.headers.entries()),
    query,
    body
  }
  const oauthResponse = await server.respondToAccessTokenRequest(request)
  return apiResponse(
    req,
    CORS_HEADERS,
    oauthResponse.body,
    oauthResponse.status as StatusCode
  )
}
