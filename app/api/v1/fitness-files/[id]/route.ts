import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { UpdateFitnessFileGearRequest } from '@/lib/services/fitness-gears/gearRequests'
import { evaluateGearServiceReminders } from '@/lib/services/fitness-gears/serviceReminders'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { buildAttachmentContentDisposition } from '@/lib/services/medias/fileName'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getFitnessFile',
  async (_req: NextRequest, context: { params: Promise<Params> }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    const { id } = await context.params

    try {
      const session = await getServerAuthSession()
      const currentActor = await getActorFromSession(database, session)
      const currentAccountId = currentActor?.account?.id

      const fileMetadata = await database.getFitnessFile({ id })
      if (!fileMetadata) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const fileActor = await database.getActorFromId({
        id: fileMetadata.actorId
      })
      const ownerAccountId = fileActor?.account?.id
      const isOwnerAccount = Boolean(
        currentAccountId && ownerAccountId === currentAccountId
      )

      // Owner only, whatever the attached status's visibility. This file is the
      // ORIGINAL upload: privacy locations trim the route map and the route-data
      // response, but they cannot trim bytes the server merely stores, so
      // serving it to a viewer handed back the coordinates every other surface
      // had just hidden. Making a public activity public does not have to mean
      // handing out the athlete's raw telemetry, and nothing federated ever
      // carried this URL — it is stripped from every outbound payload.
      //
      // 404 rather than 403: a 403 confirms the id resolves to a real file, and
      // every other rejection on this route already answers 404.
      if (!isOwnerAccount) {
        logger.warn({
          message: 'Fitness file not found or not authorized',
          fileId: id,
          actorId: currentActor?.id ?? null,
          accountId: currentAccountId ?? null
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const result = await getFitnessFile(database, id, fileMetadata)
      if (!result) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      if (result.type === 'redirect') {
        return Response.redirect(result.redirectUrl, 302)
      }

      return new Response(result.buffer as BodyInit, {
        headers: {
          'Content-Type': result.contentType,
          // Unconditional now that only the owner gets here. The previous
          // `public, max-age=31536000, immutable` on public activities pinned raw
          // GPS in every shared cache for a year, and outlived the visibility
          // change that was supposed to withdraw it.
          'Cache-Control': 'private, no-store',
          // `contentType` comes from the stored object, and on the S3 path that
          // value originates from the presigned upload's client-supplied field,
          // which has no allow-list. Owner-only already reduces the worst case
          // from stored to self-XSS; these two make it inert — the browser may
          // not re-sniff the bytes into something scriptable, and it may not
          // render them on this origin at all.
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': buildAttachmentContentDisposition(
            fileMetadata.fileName
          )
        }
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving fitness file',
        fileId: id,
        error: err.message
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)

/**
 * Attributes an activity to a piece of gear, or clears the attribution with
 * `{ gearId: null }`.
 *
 * Every rejection is a 404 — a missing activity, someone else's activity, and a
 * gear id that is not the owner's all answer the same way, so the response
 * cannot be used to confirm that an id exists.
 *
 * There is deliberately no check that the gear's kind suits the activity's
 * sport. `activityType` is free-form across four vocabularies and often absent,
 * so enforcing it here would make perfectly ordinary activities unassignable;
 * the picker narrows the options, the server only owns ownership.
 *
 * A recording device is the one exception, and it is not a taste question:
 * `gearId` answers "what was this ride done on", which a head unit never is,
 * and an activity pointed at one falls out of every rollup — see the guard in
 * `setFitnessFileGear`. It is rejected there, so it 404s like any other gear
 * this activity may not have.
 */
export const PATCH = traceApiRoute(
  'updateFitnessFileGear',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = UpdateFitnessFileGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const updated = await database.setFitnessFileGear({
      fitnessFileId: id,
      actorId: currentActor.id,
      gearId: parsed.data.gearId
    })
    if (!updated) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    if (updated.gearId) {
      // Attributing an activity can push the gear past a service threshold.
      // Best-effort: a reminder that fails must not fail the assignment.
      await evaluateGearServiceReminders({
        database,
        actorId: currentActor.id,
        gearIds: [updated.gearId]
      })
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: updated,
      responseStatusCode: 200
    })
  })
)
