import type { NextApiRequest, NextApiResponse } from 'next'
import { unstable_getServerSession } from 'next-auth'
import crypto from 'crypto'
import util from 'util'
import { authOptions } from '../auth/[...nextauth]'
import { getStorage } from '../../../lib/storage'

type Data = {
  done: boolean
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  switch (req.method) {
    case 'POST': {
      const [storage, session] = await Promise.all([
        getStorage(),
        unstable_getServerSession(req, res, authOptions)
      ])

      if (!storage || !session?.user?.email) {
        return res.status(302).redirect('/singin')
      }

      const username = req.body.username
      if (await storage?.isUsernameExists(username)) {
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
          passphrase: ''
        }
      })
      await storage.createAccount({
        email: session?.user?.email,
        username,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey
      })
      return res.status(302).redirect('/')
    }
    default:
      res.status(200).json({ done: true })
  }
}
