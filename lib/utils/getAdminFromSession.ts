import { Database } from '@/lib/database/types'
import {
  isAccountConfirmationPending,
  isActorModerationBlocked
} from '@/lib/services/guards/accountState'
import {
  AuthSession,
  getAccountFromSession,
  getActorFromSession
} from '@/lib/utils/getActorFromSession'

/**
 * Resolves the admin account behind a cookie session, applying the same
 * account-state checks `AdminApiGuard` applies to a cookie-session admin: a
 * disabled or unconfirmed account may not act, and neither may an admin whose
 * active actor is moderation-blocked.
 *
 * Admin server actions and admin pages read the session through this helper, so
 * a session minted before a moderation action cannot keep using the admin
 * surface. `getActorFromSession` is React-`cache`d, so the extra lookup is
 * shared with any later resolution in the same request.
 */
export const getAdminFromSession = async (
  database: Database,
  session: AuthSession | null
) => {
  const account = await getAccountFromSession(database, session)
  if (!account || account.role !== 'admin') return null

  if (account.disabledAt || isAccountConfirmationPending(account)) return null

  const actor = await getActorFromSession(database, session)
  if (actor && isActorModerationBlocked(actor)) return null

  return account
}
