import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { getPerson } from './activities'
import { ERROR_400 } from './errors'
import { parse, verify } from './signature'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export function apiGuard<T>(
  handle: NextApiHandler<T>,
  guardMethods?: HttpMethod[]
) {
  return async (
    req: NextApiRequest,
    res: NextApiResponse<T | { error: string }>
  ) => {
    if (!guardMethods) return handle(req, res)
    if (!guardMethods.includes(req.method as HttpMethod)) {
      return handle(req, res)
    }

    const headerSignature = req.headers.signature
    if (!headerSignature) {
      console.error('-> 400 No Signature')
      return res.status(400).send(ERROR_400)
    }

    const signatureParts = await parse(headerSignature as string)
    if (!signatureParts.keyId) {
      console.error('-> 400 No Signature key')
      return res.status(400).send(ERROR_400)
    }

    const sender = await getPerson(signatureParts.keyId, false)
    if (!sender) {
      console.error('-> 400 Person not found')
      return res.status(400).send(ERROR_400)
    }

    if (!req.url) {
      console.error('-> 400 Invalid URL')
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
      console.error('-> 400 Invalid Signature')
      return res.status(400).send(ERROR_400)
    }

    return handle(req, res)
  }
}
