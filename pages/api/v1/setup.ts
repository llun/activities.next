import { ERROR_404 } from '../../../lib/errors'
import { SetupGuard } from '../../../lib/guard'
import { generateKeyPair } from '../../../lib/signature'

const handler = SetupGuard(async (req, res, context) => {
  const { storage, email } = context
  switch (req.method) {
    case 'POST': {
      const username = req.body.username as string
      if (await storage.isUsernameExists({ username })) {
        return res.status(302).redirect('/setup?error=HANDLE_ALREADY_EXISTS')
      }

      try {
        const keyPair = await generateKeyPair()
        await storage.createAccount({
          email,
          username,
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey
        })
      } catch {
        console.error('Fail to create account')
        return res.status(302).redirect('/setup?error=FAIL_TO_CREATE_ACCOUNT')
      }

      return res.status(302).redirect('/')
    }
    default: {
      return res.status(404).json(ERROR_404)
    }
  }
})

export default handler
