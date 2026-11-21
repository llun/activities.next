import { randomUUID } from 'node:crypto'

import { deleteSessionsWithTokenDetach } from '@/lib/database/domains/account/sessions'
import {
  getAdminAccount,
  getAdminAccountRecords,
  getAdminAccounts,
  getSessionIpsForAccounts
} from '@/lib/database/domains/moderation/adminAccounts'
import type {
  ApplyModerationActionOutcome,
  ApplyModerationActionParams,
  ApproveAccountParams,
  CreateModerationActionParams,
  DeleteAllAccountSessionsParams,
  GetModerationStatesForActorsParams,
  ModerationAction,
  ModerationStates,
  RejectPendingAccountParams,
  SetAccountDisabledParams,
  SetActorSensitizedParams,
  SetActorSilencedParams,
  SetActorSuspendedParams,
  SetReportResolutionParams
} from '@/lib/database/domains/moderation/types'
import { deleteActorSearchDocument } from '@/lib/database/domains/search/accounts'
import { type Db, inTransaction } from '@/lib/database/kysely'

export const setActorSuspended = async (
  db: Db,
  { actorId, suspended }: SetActorSuspendedParams
): Promise<void> => {
  await db
    .updateTable('actors')
    .set({ suspendedAt: suspended ? new Date() : null })
    .where('id', '=', actorId)
    .execute()
}

export const setActorSilenced = async (
  db: Db,
  { actorId, silenced }: SetActorSilencedParams
): Promise<void> => {
  await db
    .updateTable('actors')
    .set({ silencedAt: silenced ? new Date() : null })
    .where('id', '=', actorId)
    .execute()
}

export const setActorSensitized = async (
  db: Db,
  { actorId, sensitized }: SetActorSensitizedParams
): Promise<void> => {
  await db
    .updateTable('actors')
    .set({ sensitizedAt: sensitized ? new Date() : null })
    .where('id', '=', actorId)
    .execute()
}

export const setAccountDisabled = async (
  db: Db,
  { accountId, disabled }: SetAccountDisabledParams
): Promise<void> => {
  await db
    .updateTable('accounts')
    .set({ disabledAt: disabled ? new Date() : null })
    .where('id', '=', accountId)
    .execute()
}

export const approveAccount = async (
  db: Db,
  { accountId }: ApproveAccountParams
): Promise<void> => {
  // Idempotent: only stamp when currently pending so a re-approval preserves
  // the original approval time.
  await db
    .updateTable('accounts')
    .set({ approvedAt: new Date() })
    .where('id', '=', accountId)
    .where('approvedAt', 'is', null)
    .execute()
}

export const rejectPendingAccount = (
  db: Db,
  { accountId }: RejectPendingAccountParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    const account = await trx
      .selectFrom('accounts')
      .select('approvedAt')
      .where('id', '=', accountId)
      .limit(1)
      .executeTakeFirst()
    // Reject is only valid for a never-approved (registration-pending)
    // account; an already approved one is left untouched.
    if (!account || account.approvedAt != null) return false

    const actors = await trx
      .selectFrom('actors')
      .select('id')
      .$narrowType<{ id: string }>()
      .where('accountId', '=', accountId)
      .execute()
    for (const { id } of actors) {
      await deleteActorSearchDocument(trx, { id })
    }
    // A never-approved account never federated, so its handles carry no
    // history a remote server could still point at: the rows go with the
    // actors and the usernames become free again. (Unlike deleteActorData,
    // which RETIRES an approved actor's rows so a federated id path is never
    // reissued.)
    if (actors.length > 0) {
      await trx
        .deleteFrom('actor_handles')
        .where(
          'actorId',
          'in',
          actors.map((actor) => actor.id)
        )
        .execute()
      await trx
        .deleteFrom('actors')
        .where(
          'id',
          'in',
          actors.map((actor) => actor.id)
        )
        .execute()
    }
    await trx
      .deleteFrom('account_providers')
      .where('accountId', '=', accountId)
      .execute()
    // Export rows reference the account; the files they point at expire with
    // the account's other storage (an unapproved account has none).
    await trx
      .deleteFrom('account_archives')
      .where('accountId', '=', accountId)
      .execute()
    await trx
      .deleteFrom('sessions')
      .where('accountId', '=', accountId)
      .execute()
    await trx.deleteFrom('accounts').where('id', '=', accountId).execute()
    return true
  })

export const getModerationStatesForActors = async (
  db: Db,
  { actorIds }: GetModerationStatesForActorsParams
): Promise<Map<string, ModerationStates>> => {
  const states = new Map<string, ModerationStates>()
  const uniqueIds = [...new Set(actorIds)]
  if (uniqueIds.length === 0) return states

  const rows = await db
    .selectFrom('actors')
    .select(['id', 'suspendedAt', 'silencedAt', 'sensitizedAt'])
    .$narrowType<{ id: string }>()
    .where('id', 'in', uniqueIds)
    .execute()

  for (const row of rows) {
    const suspendedAt = row.suspendedAt ?? null
    const silencedAt = row.silencedAt ?? null
    const sensitizedAt = row.sensitizedAt ?? null
    // Only moderated actors get a map entry, so a missing entry unambiguously
    // means "not moderated" for callers (the timeline filter, inbox drops).
    if (suspendedAt === null && silencedAt === null && sensitizedAt === null) {
      continue
    }
    states.set(row.id, { suspendedAt, silencedAt, sensitizedAt })
  }
  return states
}

export const createModerationAction = async (
  db: Db,
  {
    targetActorId,
    moderatorAccountId,
    moderatorActorId = null,
    action,
    reportId = null,
    text = ''
  }: CreateModerationActionParams
): Promise<ModerationAction> => {
  const currentTime = new Date()
  const row = {
    id: randomUUID(),
    targetActorId,
    moderatorAccountId,
    moderatorActorId,
    action,
    reportId,
    text,
    createdAt: currentTime
  }
  await db.insertInto('moderation_actions').values(row).execute()
  return {
    ...row,
    moderatorActorId: moderatorActorId ?? null,
    reportId: reportId ?? null,
    createdAt: currentTime.getTime()
  }
}

export const deleteAllAccountSessions = async (
  db: Db,
  { accountId }: DeleteAllAccountSessionsParams
): Promise<void> => {
  // `oauthAccessToken.sessionId` and `oauthRefreshToken.sessionId` are foreign
  // keys into `sessions.id` with no ON DELETE action, so a bare delete throws
  // on PostgreSQL (23503) for a session that minted OAuth tokens. The helper
  // detaches the tokens first, in the caller's transaction when there is one.
  await deleteSessionsWithTokenDetach(db, (eb) =>
    eb('accountId', '=', accountId)
  )
}

export const setReportResolution = async (
  db: Db,
  { reportId, resolved, actionTakenByActorId = null }: SetReportResolutionParams
): Promise<boolean> => {
  const result = await db
    .updateTable('reports')
    .set(
      resolved
        ? {
            actionTaken: true,
            actionTakenAt: new Date(),
            actionTakenByActorId,
            updatedAt: new Date()
          }
        : {
            actionTaken: false,
            actionTakenAt: null,
            actionTakenByActorId: null,
            updatedAt: new Date()
          }
    )
    .where('id', '=', reportId)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

/**
 * Applies a moderation action and everything that must land with it — the
 * actor/account state change, the session wipe for suspend/disable, the
 * `moderation_actions` audit row and the linked report's resolution — in one
 * transaction. A failure at any step rolls the whole action back, so an admin
 * never sees a 500 with the flag already committed and the audit trail missing.
 *
 * The caller runs side effects that cannot be transactional (deleting an
 * account's export files) after this resolves.
 */
export const applyModerationAction = (
  db: Db,
  {
    targetActorId,
    accountId = null,
    action,
    moderatorAccountId,
    moderatorActorId = null,
    reportId = null,
    text = ''
  }: ApplyModerationActionParams
): Promise<ApplyModerationActionOutcome> =>
  inTransaction(db, async (trx) => {
    switch (action) {
      case 'suspend':
        await setActorSuspended(trx, {
          actorId: targetActorId,
          suspended: true
        })
        if (accountId) {
          await deleteAllAccountSessions(trx, { accountId })
        }
        break
      case 'unsuspend':
        await setActorSuspended(trx, {
          actorId: targetActorId,
          suspended: false
        })
        break
      case 'silence':
        await setActorSilenced(trx, { actorId: targetActorId, silenced: true })
        break
      case 'unsilence':
        await setActorSilenced(trx, { actorId: targetActorId, silenced: false })
        break
      case 'sensitive':
        await setActorSensitized(trx, {
          actorId: targetActorId,
          sensitized: true
        })
        break
      case 'unsensitive':
        await setActorSensitized(trx, {
          actorId: targetActorId,
          sensitized: false
        })
        break
      case 'disable':
        await setAccountDisabled(trx, { accountId: accountId!, disabled: true })
        await deleteAllAccountSessions(trx, { accountId: accountId! })
        break
      case 'enable':
        await setAccountDisabled(trx, {
          accountId: accountId!,
          disabled: false
        })
        break
      case 'approve':
        await approveAccount(trx, { accountId: accountId! })
        break
      case 'reject': {
        const rejected = await rejectPendingAccount(trx, {
          accountId: accountId!
        })
        // An already-approved account is left untouched, and no audit row or
        // report resolution is written for an action that did not apply.
        if (!rejected) return { applied: false }
        break
      }
      case 'none':
        break
    }

    await createModerationAction(trx, {
      targetActorId,
      moderatorAccountId,
      moderatorActorId,
      action,
      reportId,
      text
    })

    if (reportId) {
      await setReportResolution(trx, {
        reportId,
        resolved: true,
        actionTakenByActorId: moderatorActorId
      })
    }

    return { applied: true }
  })

// The facade getSQLDatabase binds with bindDb().
export const moderationQueries = {
  setActorSuspended,
  setActorSilenced,
  setActorSensitized,
  setAccountDisabled,
  approveAccount,
  rejectPendingAccount,
  getModerationStatesForActors,
  createModerationAction,
  deleteAllAccountSessions,
  applyModerationAction,
  setReportResolution,
  getAdminAccounts,
  getAdminAccount,
  getAdminAccountRecords,
  getSessionIpsForAccounts
}
