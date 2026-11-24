import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getBlueskyOAuthClient } from '@/lib/services/bluesky/client'
import { headerHost } from '@/lib/services/guards/headerHost'
import { ERROR_404, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

// The public halves of the OAuth client keys (`jwks_uri`); the keyset keeps
// the private parts out of `jwks`.
export const GET = traceApiRoute('blueskyJwks', async (req: NextRequest) => {
  const database = getDatabase()
  const client = database
    ? getBlueskyOAuthClient(database, headerHost(req.headers))
    : null
  if (!client) {
    return apiResponse({
      req,
      allowedMethods: ['GET'],
      data: ERROR_404,
      responseStatusCode: 404
    })
  }
  return apiResponse({
    req,
    allowedMethods: ['GET'],
    data: (await client).jwks,
    additionalHeaders: [['Cache-Control', 'public, max-age=300']]
  })
})
