/* eslint-disable camelcase */
import { Exception } from '@opentelemetry/api'
import { HTTPError } from 'got'
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { getPublicProfile } from './activities'
import { ERROR_400, ERROR_500 } from './errors'
import { parse, verify } from './signature'
import { getStorage } from './storage'
import { Storage } from './storage/types'
import { getSpan } from './trace'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

async function getSenderPublicKey(storage: Storage, actorId: string) {
  const span = getSpan('guard', 'getSenderPublicKey', { actorId })
  const localActor = await storage.getActorFromId({ id: actorId })
  if (localActor) {
    span.end()
    return localActor.publicKey
  }

  try {
    const sender = await getPublicProfile({
      actorId,
      withCollectionCount: false,
      withPublicKey: true
    })

    if (sender) return sender.publicKey || ''
    return ''
  } catch (error) {
    span.recordException(error as Exception)
    if (!(error instanceof HTTPError)) {
      throw error
    }

    if (error.response.statusCode === 410) {
      const url = new URL(actorId)
      const sender = await getPublicProfile({
        actorId: `${url.protocol}//${url.host}/actor#main-key`,
        withPublicKey: true
      })

      if (sender) return sender.publicKey || ''
      return ''
    }

    return ''
  } finally {
    span.end()
  }
}

export function activitiesGuard<T>(
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
