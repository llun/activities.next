import { Database } from '@/lib/database/types'
import {
  deleteAccountArchiveFiles,
  listAccountArchives
} from '@/lib/services/accountArchive/purge'
import { AdminModerator } from '@/lib/services/guards/AdminApiGuard'
import {
  AdminAccountRecord,
  ModerationActionType
} from '@/lib/types/database/operations'

export type ApplyAdminAccountActionParams = {
  database: Database
  record: AdminAccountRecord
  action: ModerationActionType
  moderator: AdminModerator
  reportId?: string | null
  text?: string
}

export type ApplyAdminAccountActionResult =
  { ok: true } | { ok: false; status: 422; error: string }

// Applies a moderation action to an account/actor per the local-vs-remote
// matrix (Decision 2): suspend/silence/sensitize work on remote actors too;
// disable/enable/approve/reject are local-account-only (remote → 422). The
// state change, the session wipe, the moderation_actions audit row and the
// linked report's resolution commit together in one transaction; only the
// export-file cleanup a reject needs runs after it. `destroy` is handled by
// the DELETE route, not here.
export const applyAdminAccountAction = async ({
  database,
  record,
  action,
  moderator,
  reportId = null,
  text = ''
}: ApplyAdminAccountActionParams): Promise<ApplyAdminAccountActionResult> => {
  const { actor, account } = record
  const isLocal = Boolean(account)

  if (!isLocal && (action === 'disable' || action === 'enable')) {
    return { ok: false, status: 422, error: 'Cannot disable a remote account' }
  }
  if (!isLocal && (action === 'approve' || action === 'reject')) {
    return {
      ok: false,
      status: 422,
      error: 'Cannot approve or reject a remote account'
    }
  }
  // Mastodon 422s an unsuspend of a not-currently-suspended account.
  if (action === 'unsuspend' && !actor.suspendedAt) {
    return {
      ok: false,
      status: 422,
      error: 'Account is not currently suspended'
    }
  }

  // reject deletes the account's export rows in the transaction below, so the
  // files they point at are listed first and removed only after it commits.
  const archives =
    action === 'reject' ? await listAccountArchives(database, account!.id) : []

  const { applied } = await database.applyModerationAction({
    targetActorId: actor.id,
    accountId: account?.id ?? null,
    action,
    moderatorAccountId: moderator.accountId ?? '',
    moderatorActorId: moderator.actorId,
    reportId,
    text
  })
  if (!applied) {
    return {
      ok: false,
      status: 422,
      error: 'Account is not pending approval'
    }
  }

  if (action === 'reject') await deleteAccountArchiveFiles(archives)

  return { ok: true }
}
