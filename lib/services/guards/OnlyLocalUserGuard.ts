import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import {
  isFederationSigningActor,
  isFederationSigningActorIdUsername
} from '@/lib/services/federation/instanceActor'
import { Actor } from '@/lib/types/domain/actor'
import { normalizeUsername } from '@/lib/utils/normalizeUsername'
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

    // A reserved username is reserved case-INSENSITIVELY, and only the genuine
    // instance actor may answer at one.
    //
    // Resolving by username is what makes this necessary. The reserved-name
    // refine used to be a case-sensitive `startsWith`, so an actor named
    // `__INSTANCE__` was registerable, and the folded arm now resolves the
    // request for `__instance__` to it — serving a user-owned Person document,
    // inbox, outbox and followers at `getFederationSigningActorId(domain)`
    // itself, until `getFederationSigningActor()` first runs on that domain and
    // the exact arm takes the id back. The old id-rebuild could not reach that
    // state, and `actor.account` being truthy means the check above waves the
    // squatter through even without `allowFederationSigningActor`.
    //
    // Gated on the REQUESTED segment, not on the resolved row: the question is
    // who may answer at this URI, and a legacy row is exactly what cannot be
    // trusted to describe itself here.
    //
    // `isFederationSigningActorIdUsername`, NOT the loose prefix test the mint
    // refine uses. Only `__instance__` and `__instance__<digits>` can ever be a
    // signing-actor id, so the prefix form would de-federate a legacy
    // `__instance__archive` account — 404ing an actor document and inbox that
    // work on `main` today.
    if (
      isFederationSigningActorIdUsername(normalizeUsername(username)) &&
      !isFederationSigningActor(actor)
    ) {
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
