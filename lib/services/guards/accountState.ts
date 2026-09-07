import { Actor } from '@/lib/types/domain/actor'

/**
 * The registration's confirmation e-mail has been sent and not yet clicked.
 *
 * Two columns, and both are needed. `verificationCode` says a code is
 * outstanding — set once at registration, cleared to `''` by `verifyAccount`,
 * never set at all on an instance with no e-mail configured. `emailVerified` is
 * better-auth's own column, and `emailAndPassword.requireEmailVerification` has
 * gated credential sign-in on it since 2026-03-20; reading it here is what keeps
 * this gate and that one answering the same question.
 *
 * The pair is required because of a data defect neither column reveals alone.
 * `20260320072514_better_auth_columns` populated `emailVerified` with
 * `whereNotNull('verifiedAt')`, and `accounts.verifiedAt` carries
 * `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`), so
 * that backfill matched EVERY row — pending registrations included — and those
 * accounts have been signing in ever since. Reading `verificationCode` alone
 * refuses exactly them, with no way back: the resend endpoint needs a
 * credential, and the credential is what is being refused.
 *
 * So an account better-auth already treats as verified is not held pending
 * here either. That grants nothing new — it is the gate that has actually been
 * governing those sign-ins. Why this predicate, rather than a repair keyed on
 * when a migration ran, is the mechanism: see AGENTS.md's "An Unconfirmed
 * Account May Not Act" and the header of
 * `20260828140000_clear_stale_verification_codes`, which records the attempts
 * that got that bound wrong.
 *
 * `verifiedAt` is deliberately NOT consulted here. It is the column the default
 * ruined; any check keyed on it reads as a working gate and fires for nobody.
 */
export const isAccountConfirmationPending = <
  TAccount extends {
    verificationCode?: string | null
    emailVerified?: boolean | number | null
  }
>(
  account: TAccount
): account is TAccount & { verificationCode: string } =>
  Boolean(account.verificationCode) && !account.emailVerified

/**
 * A suspended actor, or an actor whose owning account is disabled, is blocked
 * from every authenticated API surface (bearer and cookie). Silence is NOT
 * checked here — silenced actors keep full API access; their statuses are only
 * hidden from public timelines. Reads columns already present on the loaded
 * domain Actor, so this adds no query to the hot auth path.
 */
export const isActorModerationBlocked = (actor: Actor): boolean =>
  Boolean(actor.suspendedAt) || Boolean(actor.account?.disabledAt)

/**
 * An account whose confirmation e-mail has not been clicked yet may not act
 * through a credential, which is the same answer Mastodon's `require_user!`
 * gives ("Your login is missing a confirmed e-mail address", 403) before any
 * API call runs. It matters because `POST /api/v1/accounts` hands out a real
 * user access token the moment an account is registered: without this, an
 * anonymous party holding only an app token can mint fully usable accounts for
 * addresses nobody has proven they control.
 *
 * Reads a column already present on the loaded domain Actor, so this adds no
 * query to the hot auth path. An actor with no account is left alone — the same
 * direction `isActorModerationBlocked` fails in, and the only accountless local
 * actor is the federation signing actor, which never authenticates.
 */
export const isActorConfirmationPending = (actor: Actor): boolean => {
  const { account } = actor
  if (!account) return false
  return isAccountConfirmationPending(account)
}
