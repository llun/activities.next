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
  const getFormValues = async () => {
    const form = await req.formData()
    return {
      token: form.get('token') as string | null,
      tokenTypeHint: form.get('token_type_hint') as string | null
    }
  }

  let values: { token: string | null; tokenTypeHint: string | null }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    values = await getFormValues()
  } else if (contentType.includes('application/json')) {
    const body = await req.json()
    values = {
      token: body.token,
      tokenTypeHint: body.token_type_hint
    }
  } else {
    // Try form data as default
    try {
      values = await getFormValues()
    } catch {
      return apiErrorResponse(400)
    }
  }

  const { token, tokenTypeHint } = values

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
