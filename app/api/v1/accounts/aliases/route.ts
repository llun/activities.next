import { NextRequest } from 'next/server'
import { z } from 'zod'

import type { Database } from '@/lib/database/types'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { actorIdsMatch } from '@/lib/utils/activitypub'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  StatusCode,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS: HttpMethod[] = ['GET', 'POST', 'DELETE']
const MAX_ALIASES = 10

const errorResponse = (
  req: NextRequest,
  error: string,
  responseStatusCode: StatusCode = HTTP_STATUS.UNPROCESSABLE_ENTITY
) =>
  apiResponse({
    req,
    allowedMethods: ALLOWED_METHODS,
    data: { error },
    responseStatusCode
  })

const AddAliasRequest = z.object({
  acct: z.string(),
  actorId: z.string().optional()
})

const DeleteAliasRequest = z.object({
  id: z.string(),
  actorId: z.string().optional()
})

export interface AccountAliasItem {
  id: string
  acct: string | null
}

const toAliasItems = async (
  database: Database,
  aliasIds: string[]
): Promise<AccountAliasItem[]> => {
  return Promise.all(
    aliasIds.map(async (aliasId) => {
      const row = await database.getActorFromId({ id: aliasId })
      return {
        id: aliasId,
        acct: row ? `${row.username}@${row.domain}` : null
      }
    })
  )
}

export const GET = traceApiRoute(
  'getAccountAliases',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const actorIdParam = new URL(req.url).searchParams.get('actorId')
    if (actorIdParam !== null && actorIdParam !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const actor = await database.getActorFromId({ id: currentActor.id })
    const aliases = actor?.alsoKnownAs ?? []
    const items = await toAliasItems(database, aliases)

    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: items
    })
  })
)

export const POST = traceApiRoute(
  'addAccountAlias',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = AddAliasRequest.safeParse(body)
    if (!parsed.success) {
      return errorResponse(req, 'Invalid account')
    }

    const { acct, actorId } = parsed.data
    if (actorId !== undefined && actorId !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const result = await resolveAccountTarget({ database, input: acct })
    if (result.type === 'invalid') {
      return errorResponse(req, 'Invalid account')
    }
    if (result.type === 'forbidden') {
      return errorResponse(req, 'Forbidden', HTTP_STATUS.FORBIDDEN)
    }
    if (result.type === 'not-found') {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    const targetActor = result.actor
    if (actorIdsMatch(targetActor.id, currentActor.id)) {
      return errorResponse(req, 'Cannot alias yourself')
    }

    const freshCurrentActor = await database.getActorFromId({
      id: currentActor.id
    })
    const existing = freshCurrentActor?.alsoKnownAs ?? []
    if (existing.some((alias) => actorIdsMatch(alias, targetActor.id))) {
      return errorResponse(req, 'Alias already added')
    }
    if (existing.length >= MAX_ALIASES) {
      return errorResponse(req, 'Too many aliases')
    }

    const nextAliases = [...existing, targetActor.id]
    await database.updateActor({
      actorId: currentActor.id,
      alsoKnownAs: nextAliases
    })
    await publishActorUpdate({ actorId: currentActor.id })

    const items = await toAliasItems(database, nextAliases)
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: items
    })
  })
)

export const DELETE = traceApiRoute(
  'deleteAccountAlias',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = DeleteAliasRequest.safeParse(body)
    if (!parsed.success) {
      return errorResponse(req, 'Invalid request')
    }

    const { id, actorId } = parsed.data
    if (actorId !== undefined && actorId !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const freshCurrentActor = await database.getActorFromId({
      id: currentActor.id
    })
    const existing = freshCurrentActor?.alsoKnownAs ?? []
    const index = existing.findIndex((alias) => actorIdsMatch(alias, id))
    if (index === -1) {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    const remaining = existing.filter((alias) => !actorIdsMatch(alias, id))
    await database.updateActor({
      actorId: currentActor.id,
      alsoKnownAs: remaining
    })
    await publishActorUpdate({ actorId: currentActor.id })

    const items = await toAliasItems(database, remaining)
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: items
    })
  })
)

export const OPTIONS = defaultOptions(ALLOWED_METHODS)
