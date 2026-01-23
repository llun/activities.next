import { NextRequest } from 'next/server'

import { getHostMetaXML } from '@/lib/services/wellknown'
import { HttpMethod, getCORSHeaders } from '@/lib/utils/getCORSHeaders'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('hostMeta', async (req: NextRequest) => {
  const headers = new Headers([
    ['Content-Type', 'application/xrd+xml; charset=utf-8'],
    ...Object.entries(getCORSHeaders(CORS_HEADERS, req.headers))
  ])
  return new Response(getHostMetaXML(), { headers })
})
