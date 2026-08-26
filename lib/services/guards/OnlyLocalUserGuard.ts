import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { Actor } from '@/lib/types/domain/actor'
import { apiErrorResponse } from '@/lib/utils/response'

import { headerHost } from './headerHost'
import { AppRouterParams } from './types'

export type OnlyLocalUserGuardParams = {
  username: string
}

export type OnlyLocalUserGuardHandle = (
  database: Database,
  actor: Actor,
  request: NextRequest,
  query: AppRouterParams<OnlyLocalUserGuardParams>
) => Promise<Response> | Response

export type OnlyLocalUserGuardOptions = {
  allowFederationSigningActor?: boolean
}

export const OnlyLocalUserGuard =
  (handle: OnlyLocalUserGuardHandle, options: OnlyLocalUserGuardOptions = {}) =>
  async (
    req: NextRequest,
    query: AppRouterParams<OnlyLocalUserGuardParams>
  ) => {
    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const { username } = await query.params
    const host = headerHost(req.headers)
    // Resolved by username rather than by rebuilding the actor id from the path
    // segment, so this surface folds casing the same way `/@user`, WebFinger,
    // mentions and account lookup now do. Rebuilding the id could only ever
    // match one spelling, which left the entire ActivityPub surface — actor
    // document, inbox, outbox, followers, following, statuses, collections —
    // answering `/api/users/Alice` and 404ing `/api/users/alice`.
    //
    // The host binding is unchanged: matching `domain` against `headerHost` is
    // the same constraint as requiring the id to have been minted on this host,
    // because both are written from one value in `createAccount` /
    // `createActorForAccount`. A remote actor still cannot match it.
    const actor = await database.getActorFromUsername({
      username,
      domain: host
    })
    const isAllowedActor =
      actor?.account ||
      (options.allowFederationSigningActor && isFederationSigningActor(actor))
    if (!actor || !isAllowedActor) {
      return apiErrorResponse(404)
    }

    // A suspended actor's ActivityPub surface (actor doc, outbox, followers,
    // following, per-user inbox, statuses) responds 410 Gone. Silenced actors
    // still resolve — silence only hides their statuses from public timelines.
    if (actor.suspendedAt) {
      return apiErrorResponse(410)
    }

    return handle(database, actor, req, query)
  }
