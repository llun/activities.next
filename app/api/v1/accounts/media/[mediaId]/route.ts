import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse } from '@/lib/utils/response'

interface Params {
  mediaId: string
}

export const DELETE = AuthenticatedGuard<Params>(async (_req, context) => {
  try {
    const { database, currentActor, params } = context
    const { mediaId } = (await params) ?? { mediaId: undefined }

    const account = currentActor.account
    if (!account) {
      return apiErrorResponse(401)
    }

    if (!mediaId) {
      return apiErrorResponse(400)
    }

    // Verify the media belongs to an actor in this account
    const medias = await database.getMediasForAccount({
      accountId: account.id,
      limit: 1000
    })

    const media = medias.find((m) => m.id === mediaId)
    if (!media) {
      return apiErrorResponse(404)
    }

    // Delete the media
    const deleted = await database.deleteMedia({ mediaId })
    if (!deleted) {
      return apiErrorResponse(500)
    }

    return Response.json({ success: true })
  } catch (e) {
    const nodeErr = e as NodeJS.ErrnoException
    console.error(nodeErr)
    return apiErrorResponse(500)
  }
})
