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
    // refine uses: it matches exactly the names this instance can MINT a signer
    // on, so the prefix form would de-federate a legacy `__instance__archive`
    // account — 404ing an actor document and inbox that work on `main` today.
    // See that helper for the exact set and for why the two predicates must not
    // be unified; do NOT restate it here, and in particular do not read it as
    // "every signing-actor id" (an ADOPTED headless signer can sit outside it)
    // or as `__instance__<digits>` (`__instance__0` and `__instance__007` are
    // deliberately not reserved — the minter cannot emit them).
    //
    // BOTH checks are required to serve the genuine signer, and neither
    // subsumes the other:
    //
    //  - `isAllowedActor` above. An accountless signer has a falsy
    //    `actor.account`, so it reaches the handler only through that line's
    //    `allowFederationSigningActor && isFederationSigningActor(actor)`
    //    disjunct. Delete it and the signer 404s before ever getting here, on
    //    the 9 of this guard's 14 invocations that opt in. (The other 5 —
    //    `quote_authorizations/[id]` and the four `statuses/[statusId]/*` —
    //    refuse it there deliberately.)
    //  - The `!isFederationSigningActor(actor)` conjunct below. It is what
    //    stops THIS test 404ing a signer whose name the minter can emit
    //    (`__instance__`, `__instance__<n>`).
    //
    // Note the conjunct does no work for an ADOPTED signer sitting outside the
    // mintable set, such as `__instance__archive`: the first conjunct is false
    // there, so `&&` short-circuits and this test never reaches it. That case
    // is carried by the predicate's precision, not by this line.
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
