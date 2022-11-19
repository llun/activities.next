import crypto from 'crypto'
import util from 'util'
import { getConfig } from '../../../lib/config'
import { SetupGuard } from '../../../lib/guard'
import { ERROR_404 } from '../../../lib/errors'

const handler = SetupGuard(async (req, res, context) => {
  const { storage, email } = context
  switch (req.method) {
    case 'POST': {
      const username = req.body.username
      if (await storage.isUsernameExists(username)) {
        return res.status(302).redirect('/setup?error=HANDLE_ALREADY_EXISTS')
      }

      const keyPair = await util.promisify(crypto.generateKeyPair)('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: getConfig().secretPhase
        }
      })
      await storage.createAccount({
        email,
        username,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey
      })
      return res.status(302).redirect('/')
    }
    default: {
      return res.status(404).json(ERROR_404)
    }
  }
})

export default handler
