/* eslint-disable camelcase */
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { Session, getServerSession } from 'next-auth'

import { authOptions } from '../pages/api/auth/[...nextauth]'
import { getPublicProfile } from './activities'
import { Actor } from './models/actor'
import { ERROR_400 } from './responses'
import { parse, verify } from './signature'
import { getStorage } from './storage'
import { Storage } from './storage/types'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

const ACTIVITIES_HOST = 'x-activity-next-host'
const FORWARDED_HOST = 'x-forwarded-host'

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

    const headerSignature = req.headers.signature
    if (!headerSignature) {
      return res.status(400).send(ERROR_400)
    }

    const signatureParts = await parse(headerSignature as string)
    if (!signatureParts.keyId) {
      return res.status(400).send(ERROR_400)
    }

    const sender = await getPublicProfile({
      actorId: signatureParts.keyId,
      withCollectionCount: false,
      withPublicKey: true
    })
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
        sender.publicKey || ''
      )
    ) {
      console.error('-> 400 Invalid Signature')
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

export function ApiGuard(handle: ApiHandle) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
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
}

export function RequestHost(request: NextApiRequest) {
  const headers = request.headers
  if (headers[ACTIVITIES_HOST]) return headers[ACTIVITIES_HOST]
  if (headers[FORWARDED_HOST]) return headers[FORWARDED_HOST]
  return headers.host
}
