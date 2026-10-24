import { NextRequest } from 'next/server'
import { z } from 'zod'

import {
  getMigrationState,
  performOutgoingMove,
  verifyChallenge
} from '@/lib/services/accounts/migration/outgoingMove'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS: HttpMethod[] = ['GET', 'POST', 'DELETE']

const errorResponse = (
  req: NextRequest,
  error: string,
  responseStatusCode: StatusCode = HTTP_STATUS.UNPROCESSABLE_ENTITY,
  extra?: Record<string, unknown>
) =>
  apiResponse({
    req,
    allowedMethods: ALLOWED_METHODS,
    data: { error, ...extra },
    responseStatusCode
  })

const MigrateRequest = z.object({
  acct: z.string(),
  kind: z.enum(['move', 'redirect']),
  password: z.string().optional(),
  username: z.string().optional(),
  actorId: z.string().optional()
})

export const GET = traceApiRoute(
  'getAccountMigration',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const actorIdParam = new URL(req.url).searchParams.get('actorId')
    if (actorIdParam !== null && actorIdParam !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const actor = await database.getActorFromId({ id: currentActor.id })
    if (!actor) {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: await getMigrationState(database, actor)
    })
  })
)

export const POST = traceApiRoute(
  'migrateAccount',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return errorResponse(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
    }
    const parsed = MigrateRequest.safeParse(body)
    if (!parsed.success) return errorResponse(req, 'Invalid request')

    const { kind, password, username, actorId } = parsed.data
    if (actorId !== undefined && actorId !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const challengeError = await verifyChallenge({
      actor: currentActor,
      password,
      username
    })
    if (challengeError) return errorResponse(req, challengeError)

    const actor = await database.getActorFromId({ id: currentActor.id })
    if (!actor) {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    const acct = parsed.data.acct.trim().replace(/^@/, '')
    const result = await resolveAccountTarget({ database, input: acct })
    if (result.type === 'invalid') return errorResponse(req, 'Invalid account')
    if (result.type === 'forbidden') {
      return errorResponse(req, 'Forbidden', HTTP_STATUS.FORBIDDEN)
    }
    if (result.type === 'not-found') {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    const outcome = await performOutgoingMove({
      database,
      actor,
      target: result.actor,
      kind
    })
    if (!outcome.ok) {
      return errorResponse(
        req,
        outcome.error,
        outcome.status,
        outcome.cooldownUntil ? { cooldownUntil: outcome.cooldownUntil } : {}
      )
    }

    const updated = await database.getActorFromId({ id: actor.id })
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: await getMigrationState(database, updated ?? actor)
    })
  })
)

export const DELETE = traceApiRoute(
  'clearAccountRedirect',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let expectedActorId = new URL(req.url).searchParams.get('actorId')
    const text = await req.text()
    if (text.trim().length > 0) {
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return errorResponse(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
      }
      const parsed = z
        .object({ actorId: z.string().optional() })
        .safeParse(body)
      if (!parsed.success) return errorResponse(req, 'Invalid request')
      expectedActorId = parsed.data.actorId ?? expectedActorId
    }
    if (expectedActorId !== null && expectedActorId !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const actor = await database.getActorFromId({ id: currentActor.id })
    if (!actor) {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    // A performed move cannot be undone: followers already moved and keep
    // their new follow. Only the redirect pointer is cleared.
    let current = actor
    if (actor.movedTo) {
      await database.updateActor({ actorId: actor.id, movedTo: null })
      await publishActorUpdate({ actorId: actor.id })
      current = { ...actor, movedTo: undefined }
    }
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: await getMigrationState(database, current)
    })
  })
)

export const OPTIONS = defaultOptions(ALLOWED_METHODS)
