import { DEFAULT_202, ERROR_400 } from '../../../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../../../lib/services/guards/AuthenticatedGuard'

interface Params {
  token: string
}

export const DELETE = AuthenticatedGuard<Params>(
  async (req, context, query) => {
    const { storage, currentActor } = context
    const { token } = query?.params ?? { token: undefined }
    if (!token) {
      return Response.json(ERROR_400, { status: 400 })
    }

    const accountSession = await storage.getAccountSession({
      token
    })
    if (!accountSession) {
      return Response.json(ERROR_400, { status: 400 })
    }

    if (accountSession.account.id !== currentActor.account?.id) {
      throw new Error('Invalid token')
    }

    await storage.deleteAccountSession({ token })
    return Response.json(DEFAULT_202, { status: 202 })
  }
)
