import type { PdsRepoStatus } from '@/lib/database/domains/pds/types'
import { isAccountConfirmationPending } from '@/lib/services/guards/accountState'

// The actor and account columns the effective status reads. The domain `Actor`
// fits, and so does a row the database layer selects itself.
export type PdsRepoStatusActor = {
  suspendedAt?: unknown
  deletionStatus?: string | null
  account?: {
    approvedAt?: unknown
    disabledAt?: unknown
    verificationCode?: string | null
    emailVerified?: boolean | number | null
  } | null
}

/**
 * The status a hosted repo has right now: its stored status, overridden by the
 * actor's and account's state (suspended or disabled is `takendown`; deleting,
 * unapproved or unconfirmed is `deactivated`). Free of `@atproto/*`, so the
 * database layer can use it under CommonJS.
 */
export const resolveEffectivePdsRepoStatus = (
  repo: { status: PdsRepoStatus },
  actor: PdsRepoStatusActor | null
): PdsRepoStatus => {
  if (repo.status === 'deleted') {
    return 'deleted'
  }
  if (
    repo.status === 'takendown' ||
    actor?.suspendedAt != null ||
    actor?.account?.disabledAt != null
  ) {
    return 'takendown'
  }
  if (
    repo.status === 'deactivated' ||
    !actor ||
    !actor.account ||
    Boolean(actor.deletionStatus) ||
    actor.account.approvedAt == null ||
    isAccountConfirmationPending(actor.account)
  ) {
    return 'deactivated'
  }
  return 'active'
}
