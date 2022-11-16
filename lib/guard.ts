import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { getPerson } from './activities'
import { ERROR_400 } from './errors'
import { parse, verify } from './signature'

export function guard<T>(handle: NextApiHandler<T>) {
  return async (
    req: NextApiRequest,
    res: NextApiResponse<T | { error: string }>
  ) => {
    const headerSignature = req.headers.signature
    if (!headerSignature) {
      return res.status(400).send(ERROR_400)
    }

    const signatureParts = await parse(headerSignature as string)
    if (!signatureParts.keyId) {
      return res.status(400).send(ERROR_400)
    }

    const sender = await getPerson(signatureParts.keyId, false)
    if (!sender) {
      return res.status(400).send(ERROR_400)
    }

    if (!req.url) {
      return res.status(400).send(ERROR_400)
    }
    const requestUrl = new URL(req.url, `http://${req.headers.host}`)
    if (
      !verify(
        `${req.method?.toLowerCase()} ${requestUrl.pathname}`,
        req.headers,
        sender.publicKey
      )
    ) {
      return res.status(400).send(ERROR_400)
    }

    return handle(req, res)
  }
}
