import { ApiGuard } from '../../../../../lib/guard'
import { DEFAULT_202, ERROR_400, ERROR_404 } from '../../../../../lib/responses'
import { getSpan } from '../../../../../lib/trace'

const handler = ApiGuard(async (req, res, context) => {
  const { token } = req.query
  const span = getSpan('api', 'sessions', { method: req.method })
  const { currentActor, storage } = context
  switch (req.method) {
    case 'DELETE': {
      try {
        if (!token || Array.isArray(token)) {
          throw new Error('Invalid token')
        }

        const accountSession = await storage.getAccountSession({
          token
        })
        if (!accountSession) {
          throw new Error('Invalid token')
        }

        if (accountSession.account.id !== currentActor.account?.id) {
          throw new Error('Invalid token')
        }

        await storage.deleteAccountSession({ token })
        res.status(202).json(DEFAULT_202)
      } catch (e) {
        console.error(e)
        res.status(400).json(ERROR_400)
      }
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
  span?.finish()
})

export default handler
