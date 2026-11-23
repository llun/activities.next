import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getBlueskyOAuthClient } from '@/lib/services/bluesky/client'
import { ERROR_404, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

// The atproto OAuth client metadata; its URL is the client_id.
export const GET = traceApiRoute(
  'blueskyClientMetadata',
  async (req: NextRequest) => {
    const database = getDatabase()
    const client = database ? getBlueskyOAuthClient(database) : null
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
      data: (await client).clientMetadata,
      additionalHeaders: [['Cache-Control', 'public, max-age=300']]
    })
  }
)
