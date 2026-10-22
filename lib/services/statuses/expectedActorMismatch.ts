import { NextRequest } from 'next/server'

import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse } from '@/lib/utils/response'

import {
  EXPECTED_ACTOR_HEADER,
  EXPECTED_ACTOR_MISMATCH_ERROR
} from './expectedActor'

// Server half of the web client's `Activities-Expected-Actor` extension, kept
// apart from expectedActor.ts so the client never bundles the response helpers.
// A queued request names the profile it was written as; when the signed-in
// actor is another one this is the 409 to answer with, before any write.
// An absent or blank header returns null, so other clients are unaffected.
export const expectedActorMismatchResponse = (
  req: NextRequest,
  currentActorId: string,
  allowedMethods: HttpMethod[]
) => {
  const expectedActorId = req.headers.get(EXPECTED_ACTOR_HEADER)?.trim()
  if (!expectedActorId || expectedActorId === currentActorId) return null
  return apiResponse({
    req,
    allowedMethods,
    data: { error: EXPECTED_ACTOR_MISMATCH_ERROR },
    responseStatusCode: 409
  })
}
