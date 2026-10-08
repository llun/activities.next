import { NextRequest } from 'next/server'

import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_429, HTTP_STATUS, apiResponse } from '@/lib/utils/response'

// 120 album writes (create, edit, delete, add or remove photos) per actor per
// minute. Each is a handful of small queries, so the cap is about stopping a
// runaway client or script, not a person curating an album. Per process, like
// the gallery lookup limits.
const ALBUM_WRITES_PER_MINUTE = 120
const ONE_MINUTE_MS = 60 * 1000
const albumWrites = createWindowCounter({
  limit: ALBUM_WRITES_PER_MINUTE,
  windowMs: ONE_MINUTE_MS
})

/** Counts one album write for the actor; false once over the limit. */
export const tryAlbumWrite = (actorId: string): boolean =>
  albumWrites.tryHit(actorId)

export const albumRateLimited = (req: NextRequest, methods: HttpMethod[]) =>
  apiResponse({
    req,
    allowedMethods: methods,
    data: ERROR_429,
    responseStatusCode: HTTP_STATUS.TOO_MANY_REQUESTS
  })

/** The request's JSON body, or `undefined` when there is none or it is not JSON. */
export const readJsonBody = async (req: NextRequest): Promise<unknown> => {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}
