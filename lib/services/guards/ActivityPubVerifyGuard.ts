import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { ERROR_400, ERROR_500 } from '@/lib/errors'
import { parse, verify } from '@/lib/signature'
import { getStorage } from '@/lib/storage'

import { getSenderPublicKey } from './getSenderPublicKey'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export const ActivityPubVerifyGuard = <T>(
  handle: NextApiHandler<T>,
  guardMethods?: HttpMethod[]
) => {
  return async (
    req: NextApiRequest,
    res: NextApiResponse<T | { error: string }>
  ) => {
    if (!guardMethods) return handle(req, res)
    if (!guardMethods.includes(req.method as HttpMethod)) {
      return handle(req, res)
    }

    const storage = await getStorage()
    if (!storage) {
      return res.status(500).send(ERROR_500)
    }

    const headerSignature = req.headers.signature
    if (!headerSignature) {
      return res.status(400).send(ERROR_400)
    }

    const signatureParts = await parse(headerSignature as string)
    if (!signatureParts.keyId) {
      return res.status(400).send(ERROR_400)
    }

    if (!req.url) {
      return res.status(400).send(ERROR_400)
    }
    const requestUrl = new URL(req.url, `http://${req.headers.host}`)
    const publicKey = await getSenderPublicKey(storage, signatureParts.keyId)
    if (
      !verify(
        `${req.method?.toLowerCase()} ${requestUrl.pathname}`,
        req.headers,
        publicKey
      )
    ) {
      return res.status(400).send(ERROR_400)
    }

    return handle(req, res)
  }
}
