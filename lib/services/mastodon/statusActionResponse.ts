import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse } from '@/lib/utils/response'

interface MastodonStatusResponseParams {
  req: NextRequest
  database: Database
  currentActor: Actor
  status: Status
  allowedMethods: HttpMethod[]
}

/**
 * Converts an already-resolved status into a Mastodon status API response,
 * returning a 500 when conversion fails. Shared by the status-action routes
 * (favourite, bookmark, reblog, …) which all end by returning the affected
 * status in Mastodon shape.
 */
export const mastodonStatusResponse = async ({
  req,
  database,
  currentActor,
  status,
  allowedMethods
}: MastodonStatusResponseParams) => {
  const mastodonStatus = await getMastodonStatus(
    database,
    status,
    currentActor.id
  )
  if (!mastodonStatus) return apiCorsError(req, allowedMethods, 500)

  return apiResponse({ req, allowedMethods, data: mastodonStatus })
}

interface RefetchedStatusResponseParams {
  req: NextRequest
  database: Database
  currentActor: Actor
  statusId: string
  allowedMethods: HttpMethod[]
}

/**
 * Re-reads a status by id with the current actor's view (to pick up updated
 * counters/flags) and returns it as a Mastodon status API response. Returns a
 * 500 when the status can no longer be read or converted.
 */
export const refetchedStatusResponse = async ({
  req,
  database,
  currentActor,
  statusId,
  allowedMethods
}: RefetchedStatusResponseParams) => {
  const updatedStatus = await database.getStatus({
    statusId,
    withReplies: false,
    currentActorId: currentActor.id
  })
  if (!updatedStatus) return apiCorsError(req, allowedMethods, 500)

  return mastodonStatusResponse({
    req,
    database,
    currentActor,
    status: updatedStatus,
    allowedMethods
  })
}
