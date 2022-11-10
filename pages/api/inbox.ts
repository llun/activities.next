import type { NextApiHandler } from 'next'
import { parse, verify } from '../../lib/signature'
import { getStorage } from '../../lib/storage'

const ApiHandler: NextApiHandler = async (req, res) => {
  const headerSignature = req.headers.signature
  if (!headerSignature) {
    return res.status(400).send('Bad request')
  }

  const signatureParts = await parse(headerSignature as string)
  if (!signatureParts.keyId) {
    return res.status(400).send('Bad request')
  }

  const sender = await fetch(signatureParts.keyId, {
    headers: {
      Host: new URL(signatureParts.keyId).host,
      Accept: 'application/activity+json, application/ld+json'
    }
  }).then((response) => response.json())
  if (!verify(req.headers, sender.publicKey.publicKeyPem)) {
    return res.status(403).send('Bad request')
  }

  const body = JSON.parse(req.body)
  const storage = await getStorage()
  storage?.createStatus({})

  res.status(202).send('')
}
export default ApiHandler
