/* eslint-disable camelcase */
import { Exception } from '@opentelemetry/api'
import { HTTPError } from 'got'
import { IncomingHttpHeaders } from 'http'
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { NextRequest } from 'next/server'

import { authOptions } from '../app/api/auth/[...nextauth]/authOptions'
import { getPublicProfile } from './activities'
import { getConfig } from './config'
import {
  ACTIVITIES_HOST,
  ACTIVITIES_SHARED_KEY,
  FORWARDED_HOST
} from './constants'
import { ERROR_400, ERROR_403, ERROR_500 } from './errors'
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

export type AppRouterParams<P> = { params: P }
export type AppRouterApiHandle<P> = (
  request: NextRequest,
  params?: AppRouterParams<P>
) => Promise<Response> | Response

export type AuthenticatedApiHandle<P> = (
  request: NextRequest,
  context: BaseContext & { currentActor: Actor },
  params?: AppRouterParams<P>
) => Promise<Response> | Response

export const AuthenticatedGuard =
  <P>(handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const [storage, session] = await Promise.all([
      getStorage(),
      getServerSession(authOptions)
    ])
    if (!storage || !session?.user?.email) {
      return Response.redirect('/signin', 307)
    }

    const currentActor = await storage.getActorFromEmail({
      email: session.user.email
    })
    if (!currentActor) {
      return Response.redirect('/signin', 307)
    }

    return handle(req, { currentActor, storage, session }, params)
  }

export const AppRouterSharedKeyGuard =
  <P>(handle: AppRouterApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const config = getConfig()
    const sharedKey = config.internalApi?.sharedKey
    if (!sharedKey) {
      return Response.json(ERROR_403, { status: 403 })
    }

    const headers = req.headers
    if (
      !headers.get(ACTIVITIES_SHARED_KEY) ||
      headers.get(ACTIVITIES_SHARED_KEY) !== sharedKey
    ) {
      return Response.json(ERROR_403, { status: 403 })
    }

    return handle(req, params)
  }

export function headerHost(headers: IncomingHttpHeaders | Headers) {
  const config = getConfig()

  if (headers.constructor.name === Headers.name) {
    const standardHeaders = headers as Headers
    if (standardHeaders.get(ACTIVITIES_HOST)) {
      return standardHeaders.get(ACTIVITIES_HOST)
    }
    if (standardHeaders.get(FORWARDED_HOST)) {
      return standardHeaders.get(FORWARDED_HOST)
    }

    if (standardHeaders.get('host')) {
      return standardHeaders.get('host')
    }

    return config.host
  }

  const nodeHeaders = headers as IncomingHttpHeaders
  const normalizedHeaders = Object.keys(nodeHeaders).reduce(
    (out, key) => ({ ...out, [key.toLowerCase()]: nodeHeaders[key] }),
    {} as IncomingHttpHeaders
  )

  if (normalizedHeaders[ACTIVITIES_HOST]) {
    return normalizedHeaders[ACTIVITIES_HOST]
  }

  if (normalizedHeaders[FORWARDED_HOST]) {
    return normalizedHeaders[FORWARDED_HOST]
  }

  if (normalizedHeaders.host) {
    return normalizedHeaders.host
  }

  return config.host
}
