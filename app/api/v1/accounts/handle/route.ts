import { NextRequest } from 'next/server'
import { z } from 'zod'

import { RENAME_STATUS_URLS_JOB_NAME } from '@/lib/jobs/names'
import {
  getStatusUrlPrefix,
  renameStatusUrlsJobId
} from '@/lib/jobs/renameStatusUrlsJob'
import {
  getHandleState,
  resolveAllowedDomain
} from '@/lib/services/accounts/handleRename'
import { localUsernameSchema } from '@/lib/services/accounts/localUsername'
import {
  MOVE_COOLDOWN_MS,
  verifyChallenge
} from '@/lib/services/accounts/migration/outgoingMove'
import { ACCOUNT_MOVED_ERROR } from '@/lib/services/accounts/movedAccount'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS: HttpMethod[] = ['GET', 'POST']

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

const HandleRequest = z.object({
  username: z.string(),
  domain: z.string().optional(),
  password: z.string().optional(),
  currentUsername: z.string().optional(),
  actorId: z.string().optional()
})

export const GET = traceApiRoute(
  'getAccountHandle',
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
      data: await getHandleState({
        database,
        actor,
        currentHost: headerHost(req.headers)
      })
    })
  })
)

export const POST = traceApiRoute(
  'renameAccountHandle',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    // The headless federation signer is not a profile anyone may rename; it
    // has no account behind it, so answer before reading anything else.
    if (isFederationSigningActor(currentActor)) {
      return errorResponse(
        req,
        'This profile cannot be renamed',
        HTTP_STATUS.FORBIDDEN
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return errorResponse(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
    }
    const parsed = HandleRequest.safeParse(body)
    if (!parsed.success) return errorResponse(req, 'Invalid request')

    const { username, domain, password, currentUsername, actorId } = parsed.data
    if (actorId !== undefined && actorId !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    // Passwordless accounts confirm with their CURRENT username, so the body
    // carries it separately: `username` is the new name (D6).
    const challengeError = await verifyChallenge({
      actor: currentActor,
      password,
      username: currentUsername
    })
    if (challengeError) return errorResponse(req, challengeError)

    const parsedUsername = localUsernameSchema.safeParse(username)
    if (!parsedUsername.success) return errorResponse(req, 'Invalid username')

    const actor = await database.getActorFromId({ id: currentActor.id })
    if (!actor) {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    const resolvedDomain = await resolveAllowedDomain(
      database,
      actor,
      domain,
      headerHost(req.headers)
    )
    if (!resolvedDomain) {
      return errorResponse(
        req,
        'Domain is not allowed',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const result = await database.recordActorHandleRename({
      actorId: actor.id,
      username: parsedUsername.data,
      domain: resolvedDomain,
      now: new Date(),
      cooldownMs: MOVE_COOLDOWN_MS
    })
    if (!result.ok) {
      switch (result.status) {
        case 'not_found':
          return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
        case 'moved':
          return errorResponse(req, ACCOUNT_MOVED_ERROR)
        case 'unavailable':
          return errorResponse(req, 'This account is not available')
        case 'cannot_rename':
          return errorResponse(req, 'This profile cannot be renamed')
        case 'unchanged':
          return errorResponse(req, 'Nothing to change')
        case 'cooldown': {
          const cooldownUntil = new Date(result.cooldownUntil).toISOString()
          return errorResponse(
            req,
            'Handle was changed recently; please wait before renaming again',
            HTTP_STATUS.TOO_MANY_REQUESTS,
            { cooldownUntil }
          )
        }
        case 'taken':
          return errorResponse(req, 'Username already exists')
      }
    }

    // A rename always changes the federated identity, so the Update(Person)
    // goes out unconditionally (never gated on hasFederatedProfileChange).
    await publishActorUpdate({ actorId: actor.id })

    // The permalink rewrite is best effort: the rename is already committed,
    // and the job's deterministic id lets a later retry requeue it.
    try {
      await getQueue().publish({
        id: renameStatusUrlsJobId(result.handleId),
        name: RENAME_STATUS_URLS_JOB_NAME,
        data: {
          handleId: result.handleId,
          actorId: actor.id,
          fromPrefix: getStatusUrlPrefix(result.previous),
          toPrefix: getStatusUrlPrefix(result.current),
          after: null
        }
      })
    } catch (error) {
      logger.error({
        message: 'Failed to queue the status URL rewrite after a rename',
        actorId: actor.id,
        handleId: result.handleId,
        err: toLoggableError(error)
      })
    }

    const updated = await database.getActorFromId({ id: actor.id })
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: await getHandleState({
        database,
        actor: updated ?? actor,
        currentHost: headerHost(req.headers)
      })
    })
  })
)

export const OPTIONS = defaultOptions(ALLOWED_METHODS)
