import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { apiErrorResponse } from '@/lib/utils/response'

export const GET = AuthenticatedGuard(async (_req, context) => {
  try {
    const { database, currentActor } = context

    const account = currentActor.account
    if (!account) {
      return apiErrorResponse(401)
    }

    // Get storage usage
    const used = await database.getStorageUsageForAccount({
      accountId: account.id
    })

    // Get quota limit
    const limit = getQuotaLimit()

    // Get medias for account
    const medias = await database.getMediasForAccount({
      accountId: account.id,
      limit: 100
    })

    return Response.json({
      used,
      limit,
      medias: medias.map((media) => ({
        id: media.id,
        actorId: media.actorId,
        bytes: media.original.bytes + (media.thumbnail?.bytes ?? 0),
        mimeType: media.original.mimeType,
        width: media.original.metaData.width,
        height: media.original.metaData.height,
        description: media.description
      }))
    })
  } catch (e) {
    const nodeErr = e as NodeJS.ErrnoException
    console.error(nodeErr)
    return apiErrorResponse(500)
  }
})
