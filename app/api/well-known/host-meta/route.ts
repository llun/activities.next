import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { HttpMethod, getCORSHeaders } from '@/lib/utils/getCORSHeaders'
import { defaultOptions } from '@/lib/utils/response'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  const config = getConfig()
  const headers = new Headers([
    ['Content-Type', 'application/xrd+xml; charset=utf-8'],
    ...Object.entries(getCORSHeaders(CORS_HEADERS, req.headers))
  ])
  return new Response(
    `
  <?xml version="1.0" encoding="UTF-8"?>
  <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
    <Link rel="lrdd" template="https://${config.host}/.well-known/webfinger?resource={uri}"/>
  </XRD>`.trim(),
    {
      headers
    }
  )
}
