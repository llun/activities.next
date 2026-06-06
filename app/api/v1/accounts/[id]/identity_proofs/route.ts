import { NextRequest } from 'next/server'

import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/accounts/:id/identity_proofs — deprecated upstream (identity
// proofs via Keybase were removed from Mastodon). Always returns an empty
// array for client compatibility.
// https://docs.joinmastodon.org/methods/accounts/#identity_proofs
export const GET = traceApiRoute(
  'getAccountIdentityProofs',
  async (req: NextRequest) =>
    apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
)
