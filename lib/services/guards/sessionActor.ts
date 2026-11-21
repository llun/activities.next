import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import {
  getAccountFromSession,
  getActorFromSession
} from '@/lib/utils/getActorFromSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import {
  isAccountConfirmationPending,
  isActorConfirmationPending,
  isActorModerationBlocked
} from './accountState'

export type ServerAuthSession = NonNullable<
  Awaited<ReturnType<typeof getServerAuthSession>>
>

export type SessionActorResolution =
  | { type: 'unauthenticated' }
  | { type: 'blocked' }
  | { type: 'actor'; actor: Actor; session: ServerAuthSession }

export type SessionAccountResolution =
  | { type: 'unauthenticated' }
  | { type: 'blocked' }
  | { type: 'account'; account: Account; session: ServerAuthSession }

/**
 * Resolves the cookie session's acting actor and applies the same account-state
 * checks `AuthenticatedGuard` applies: a suspended actor, a disabled account, or
 * an unconfirmed account is refused.
 *
 * Route handlers that authenticate the cookie session by hand use this instead
 * of reading the session and resolving the actor themselves, so they cannot
 * drift from the guard. It answers a discriminated result rather than a
 * `Response` because each route keeps its own response shape (CORS headers,
 * `apiResponse` vs `apiErrorResponse`).
 *
 * `getServerAuthSession` and `getActorFromSession` are both React-`cache`d, so
 * calling this after a route has already read either costs no extra query.
 */
export const resolveSessionActor = async (
  database: Database
): Promise<SessionActorResolution> => {
  const session = await getServerAuthSession()
  if (!session?.user?.email) return { type: 'unauthenticated' }

  const actor = await getActorFromSession(database, session)
  if (!actor) return { type: 'unauthenticated' }

  if (isActorModerationBlocked(actor) || isActorConfirmationPending(actor)) {
    return { type: 'blocked' }
  }

  return { type: 'actor', actor, session }
}

/**
 * The optional-session counterpart: a blocked session is downgraded to the
 * anonymous path rather than refused, so a public read never fails because a
 * cookie was presented. This mirrors `OptionalOAuthGuard`'s
 * `unconfirmedAccount: 'anonymous'` disposition — a credential must never make
 * a request worse than sending none.
 */
export const resolveOptionalSessionActor = async (
  database: Database
): Promise<Actor | null> => {
  const resolved = await resolveSessionActor(database)
  return resolved.type === 'actor' ? resolved.actor : null
}

/**
 * Resolves the account behind the cookie session without selecting an actor.
 *
 * Account-level routes (`actors/switch`, `actors/cancel-deletion`) act on an
 * actor the caller names, so gating on the session's selected actor would
 * refuse them whenever that actor is suspended or pending deletion. They
 * resolve the account instead and apply their own checks — see
 * docs/architecture.md's "An Unconfirmed Account May Not Act". This helper
 * exists so those routes stop reading the cookie session by hand.
 *
 * It still refuses an unconfirmed account, and a disabled one unless the caller
 * passes `{ allowDisabled: true }` — the same account-state checks the guard
 * family applies, so a route cannot use "account-level" as a way around them.
 * `actors/cancel-deletion` is the one caller that opts out of the disabled
 * check: a disabled account must still be able to cancel a scheduled deletion.
 */
export const resolveSessionAccount = async (
  database: Database,
  options: { allowDisabled?: boolean } = {}
): Promise<SessionAccountResolution> => {
  const session = await getServerAuthSession()
  if (!session?.user?.email) return { type: 'unauthenticated' }

  const account = await getAccountFromSession(database, session)
  if (!account) return { type: 'unauthenticated' }

  if (isAccountConfirmationPending(account)) return { type: 'blocked' }
  if (!options.allowDisabled && account.disabledAt) return { type: 'blocked' }

  return { type: 'account', account, session }
}

/**
 * Resolves the admin account behind the cookie session, applying the same
 * account-state checks `AdminApiGuard` applies to a cookie-session admin. Admin
 * server actions use this instead of reading the session and calling
 * `getAdminFromSession` themselves, so they cannot skip those checks.
 */
export const resolveSessionAdmin = async (database: Database) => {
  const session = await getServerAuthSession()
  if (!session?.user?.email) return null
  return getAdminFromSession(database, session)
}
