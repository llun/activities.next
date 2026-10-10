import { randomUUID } from 'node:crypto'

import {
  getAdminAccount,
  getAdminAccountRecords,
  getAdminAccounts,
  getSessionIpsForAccounts
} from '@/lib/database/domains/moderation/adminAccounts'
import type {
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
    if (actors.length > 0) {
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
  await db.deleteFrom('sessions').where('accountId', '=', accountId).execute()
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
  setReportResolution,
  getAdminAccounts,
  getAdminAccount,
  getAdminAccountRecords,
  getSessionIpsForAccounts
}
