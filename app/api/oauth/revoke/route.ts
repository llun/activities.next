import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { revokeToken } from '@/lib/services/oauth/revoke'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute('revokeToken', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) return apiErrorResponse(500)

  const contentType = req.headers.get('content-type') || ''
  let token: string | null
  let tokenTypeHint: string | null

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData()
    token = form.get('token') as string | null
    tokenTypeHint = form.get('token_type_hint') as string | null
  } else if (contentType.includes('application/json')) {
    const body = (await req.json()) as {
      token?: string
      token_type_hint?: string
    }
    token = body.token || null
    tokenTypeHint = body.token_type_hint || null
  } else {
    // Try form data as default
    try {
      const form = await req.formData()
      token = form.get('token') as string | null
      tokenTypeHint = form.get('token_type_hint') as string | null
    } catch {
      return apiErrorResponse(400)
    }
  }

  if (!token) {
    return apiErrorResponse(400)
  }

  await revokeToken({ database, token, tokenTypeHint })

  // RFC 7009 specifies returning 200 OK on success
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {}
  })
})
