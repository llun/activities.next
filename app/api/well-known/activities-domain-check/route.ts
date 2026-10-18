import { NextRequest } from 'next/server'

import {
  getDomainCheckProof,
  getDomainCheckRequestHost,
  isDomainCheckNonce
} from '@/lib/services/domains/domainCheck'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /.well-known/activities-domain-check?nonce=<n> — the answer Admin ›
// Domains looks for when it checks that a domain reaches this server: an HMAC
// of the nonce and the host this request arrived with, under a key derived
// from the server secret (see lib/services/domains/domainCheck.ts). Public and
// stateless; it reveals nothing about the secret or the request.
export const GET = traceApiRoute('domainCheck', async (req: NextRequest) => {
  const nonce = new URL(req.url).searchParams.get('nonce')
  if (!isDomainCheckNonce(nonce)) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_400,
      responseStatusCode: 400
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      proof: getDomainCheckProof(
        nonce as string,
        getDomainCheckRequestHost(req.headers)
      )
    },
    additionalHeaders: [['Cache-Control', 'no-store']]
  })
})
