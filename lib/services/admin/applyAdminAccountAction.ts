import { Database } from '@/lib/database/types'
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
// disable/enable/approve/reject are local-account-only (remote → 422). Every
// applied action appends a moderation_actions audit row; a linked report_id is
// resolved. `destroy` is handled by the DELETE route, not here.
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

  switch (action) {
    case 'suspend':
      await database.setActorSuspended({ actorId: actor.id, suspended: true })
      if (account) {
        await database.deleteAllAccountSessions({ accountId: account.id })
      }
      break
    case 'unsuspend':
      // Mastodon 422s an unsuspend of a not-currently-suspended account.
      if (!actor.suspendedAt) {
        return {
          ok: false,
          status: 422,
          error: 'Account is not currently suspended'
        }
      }
      await database.setActorSuspended({ actorId: actor.id, suspended: false })
      break
    case 'silence':
      await database.setActorSilenced({ actorId: actor.id, silenced: true })
      break
    case 'unsilence':
      await database.setActorSilenced({ actorId: actor.id, silenced: false })
      break
    case 'sensitive':
      await database.setActorSensitized({ actorId: actor.id, sensitized: true })
      break
    case 'unsensitive':
      await database.setActorSensitized({
        actorId: actor.id,
        sensitized: false
      })
      break
    case 'disable':
      await database.setAccountDisabled({
        accountId: account!.id,
        disabled: true
      })
      await database.deleteAllAccountSessions({ accountId: account!.id })
      break
    case 'enable':
      await database.setAccountDisabled({
        accountId: account!.id,
        disabled: false
      })
      break
    case 'approve':
      await database.approveAccount({ accountId: account!.id })
      break
    case 'reject': {
      const rejected = await database.rejectPendingAccount({
        accountId: account!.id
      })
      if (!rejected) {
        return {
          ok: false,
          status: 422,
          error: 'Account is not pending approval'
        }
      }
      break
    }
    case 'none':
      break
  }

  await database.createModerationAction({
    targetActorId: actor.id,
    moderatorAccountId: moderator.accountId ?? '',
    moderatorActorId: moderator.actorId,
    action,
    reportId,
    text
  })

  if (reportId) {
    await database.setReportResolution({
      reportId,
      resolved: true,
      actionTakenByActorId: moderator.actorId
    })
  }

  return { ok: true }
}
