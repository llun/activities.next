import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'

/**
 * The component routes' shared front door: 404 for gear that is not the caller's
 * and 422 for a device, or null to carry on.
 *
 * A device has no parts to service — it is not something a chain wears out on —
 * so the five component endpoints all reject one. They share this helper because
 * five independent copies of the same two-line check is exactly how one of them
 * ends up letting a bottom bracket be fitted to a watch.
 */
export const rejectComponentsForDevice = async ({
  req,
  database,
  actorId,
  gearId
}: {
  req: NextRequest
  database: Database
  actorId: string
  gearId: string
}): Promise<Response | null> => {
  const gear = await database.getFitnessGear({ id: gearId, actorId })
  if (!gear) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
  if (gear.kind !== 'device') return null

  return apiResponse({
    req,
    allowedMethods: [],
    data: { error: 'A recording device has no components' },
    responseStatusCode: 422
  })
}
