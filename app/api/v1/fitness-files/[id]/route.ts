import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { buildAttachmentContentDisposition } from '@/lib/services/medias/fileName'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiErrorResponse } from '@/lib/utils/response'
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
