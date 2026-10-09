import { NextRequest } from 'next/server'

import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { Actor } from '@/lib/types/domain/actor'
import { getTrustedClientIp } from '@/lib/utils/getTrustedClientIp'
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

// The public album reads (`/accounts/:id/gallery/albums`) are open to anyone,
// and an album list reads every visible photo of every public album to build
// its covers and counts, so they are bounded too: 300 reads per viewer per
// minute. A signed-in viewer is keyed by their actor. A logged-out one only by
// the client address, and only when the operator trusts the proxy headers
// (`ACTIVITIES_TRUST_PROXY_IP_HEADERS`): client IP headers are spoofable
// otherwise, so with no trusted address a logged-out read is not limited here
// and an upstream limiter has to do it, as for the other anonymous gallery
// reads. Per process, like the write limit.
const ALBUM_READS_PER_MINUTE = 300
const albumReads = createWindowCounter({
  limit: ALBUM_READS_PER_MINUTE,
  windowMs: ONE_MINUTE_MS
})

/** Who a public album read is counted against; null when nothing safe names them. */
export const getAlbumReadKey = (
  req: NextRequest,
  currentActor: Pick<Actor, 'id'> | null | undefined
): string | null => {
  if (currentActor) return `actor:${currentActor.id}`
  const ip = getTrustedClientIp(req)
  return ip ? `ip:${ip}` : null
}

/** Counts one public album read; false once the viewer is over the limit. */
export const tryAlbumRead = (key: string | null): boolean =>
  key === null ? true : albumReads.tryHit(key)

// Suggestions read the owner's whole gallery index, so they are limited like
// the other costly gallery reads: 20 per actor per minute. The dialog asks once
// per visit to the Albums tab, so this is a runaway client's ceiling, not a
// person's. Its photo pages (up to 100 ids each) are cheap by comparison: 120
// per minute, enough to page through a 2,000 photo suggestion.
const SUGGESTION_READS_PER_MINUTE = 20
const SUGGESTION_MEDIA_READS_PER_MINUTE = 120
const suggestionReads = createWindowCounter({
  limit: SUGGESTION_READS_PER_MINUTE,
  windowMs: ONE_MINUTE_MS
})
const suggestionMediaReads = createWindowCounter({
  limit: SUGGESTION_MEDIA_READS_PER_MINUTE,
  windowMs: ONE_MINUTE_MS
})

/** Counts one suggestions read for the actor; false once over the limit. */
export const trySuggestionRead = (actorId: string): boolean =>
  suggestionReads.tryHit(actorId)

/** Counts one suggestion photo page for the actor; false once over the limit. */
export const trySuggestionMediaRead = (actorId: string): boolean =>
  suggestionMediaReads.tryHit(actorId)

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
