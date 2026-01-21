import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse } from '@/lib/utils/response'

export const DELETE = AuthenticatedGuard(
  async (_req, context, { params }: { params: Promise<{ mediaId: string }> }) => {
    try {
      const { database, account } = context
      const { mediaId } = await params

      if (!account) {
        return apiErrorResponse(401)
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
  }
)
