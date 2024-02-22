import {
  DEFAULT_202,
  apiErrorResponse,
  defaultStatusOption
} from '@/lib/response'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

interface Params {
  token: string
}

export const DELETE = AuthenticatedGuard<Params>(
  async (req, context, query) => {
    const { storage, currentActor } = context
    const { token } = query?.params ?? { token: undefined }
    if (!token) return apiErrorResponse(400)

    const accountSession = await storage.getAccountSession({
      token
    })
    if (!accountSession) return apiErrorResponse(404)

    if (accountSession.account.id !== currentActor.account?.id) {
      throw new Error('Invalid token')
    }

    await storage.deleteAccountSession({ token })
    return Response.json(DEFAULT_202, defaultStatusOption(202))
  }
)
