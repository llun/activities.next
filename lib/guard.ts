/* eslint-disable camelcase */
import { HTTPError } from 'got'
import { IncomingHttpHeaders } from 'http'
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'

import { authOptions } from '../pages/api/auth/[...nextauth]'
import { getPublicProfile } from './activities'
import { Error } from './activities/types'
import { getConfig } from './config'
import { ACTIVITIES_HOST, FORWARDED_HOST } from './constants'
import { ERROR_400, ERROR_404, ERROR_500 } from './errors'
import { Actor } from './models/actor'
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
    span.recordException(error as Error)
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

export type BaseContext = {
  storage: Storage
  session: Session
}

export type SetupHandle = (
  req: NextApiRequest,
  res: NextApiResponse,
  context: BaseContext & {
    email: string
  }
) => unknown | Promise<unknown>

export function SetupGuard(handle: SetupHandle) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const [storage, session] = await Promise.all([
      getStorage(),
      getServerSession(req, res, authOptions)
    ])
    if (!storage || !session?.user?.email) {
      return res.status(302).redirect('/singin')
    }

    return handle(req, res, { storage, session, email: session.user.email })
  }
}

export type ApiHandle = (
  req: NextApiRequest,
  res: NextApiResponse,
  context: BaseContext & {
    currentActor: Actor
  }
) => unknown | Promise<unknown>

export const ApiGuard =
  (handle: ApiHandle): NextApiHandler<unknown> =>
  async (req, res) => {
    const [storage, session] = await Promise.all([
      getStorage(),
      getServerSession(req, res, authOptions)
    ])
    if (!storage || !session?.user?.email) {
      return res.status(302).redirect('/singin')
    }

    const currentActor = await storage.getActorFromEmail({
      email: session.user.email
    })
    if (!currentActor) {
      return res.status(302).redirect('/singin')
    }

    return handle(req, res, { storage, session, currentActor })
  }

export const SharedKeyApiGuard =
  <T>(handle: NextApiHandler<T>): NextApiHandler<T | Error> =>
  async (req, res) => {
    const config = getConfig()
    const sharedKey = config.internalApi?.sharedKey
    if (!sharedKey) {
      res.status(404).send(ERROR_404)
      return
    }

    return handle(req, res)
  }

export function headerHost(headers: IncomingHttpHeaders) {
  if (headers[ACTIVITIES_HOST]) return headers[ACTIVITIES_HOST]
  if (headers[FORWARDED_HOST]) return headers[FORWARDED_HOST]
  return headers.host
}
