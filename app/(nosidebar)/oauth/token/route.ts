import { getOAuth2Server } from "@/lib/services/oauth/server"
import { getCORSHeaders } from "@/lib/utils/getCORSHeaders"
import { NextRequest } from "next/server"

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
  const oauthResponse = await server.respondToAccessTokenRequest(request);
  console.log(oauthResponse)

  return Response.json({ message: 'hello, world' }, {
    status: 200,
    statusText: 'OK',
    headers: getCORSHeaders('POST', req.headers)
  })
}
