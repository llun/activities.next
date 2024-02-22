import { NextRequest } from 'next/server'

import { StatusCode, defaultOptions, statusText } from '@/lib/response'
import { getOAuth2Server } from '@/lib/services/oauth/server'
import { HttpMethod, getCORSHeaders } from '@/lib/utils/getCORSHeaders'

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
  return Response.json(oauthResponse.body, {
    status: oauthResponse.status,
    statusText: statusText(oauthResponse.status as StatusCode),
    headers: new Headers({
      ...getCORSHeaders(CORS_HEADERS, req.headers),
      ...Object.entries(oauthResponse.headers)
    })
  })
}
