import { getConfig } from '../../../lib/config'
import { ERROR_404 } from '../../../lib/errors'
import { SetupGuard } from '../../../lib/guard'
import { generateKeyPair } from '../../../lib/signature'

const handler = SetupGuard(async (req, res, context) => {
  const { storage, email } = context
  switch (req.method) {
    case 'POST': {
      const { username, domain } = req.body
      if (await storage.isUsernameExists({ username, domain })) {
        res.status(302).redirect('/setup?error=HANDLE_ALREADY_EXISTS')
        return
      }

      try {
        const keyPair = await generateKeyPair(getConfig().secretPhase)
        await storage.createAccount({
          email,
          username,
          domain,
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey
        })
      } catch {
        console.error('Fail to create account')
        res.status(302).redirect('/setup?error=FAIL_TO_CREATE_ACCOUNT')
        return
      }

      res.status(302).redirect('/')
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
