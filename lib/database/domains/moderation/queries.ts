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
import { revokeAccountOAuthTokens } from '@/lib/database/domains/oauth/queries'
import { deletePdsRepoData } from '@/lib/database/domains/pds/queries'
import { deleteActorSearchDocument } from '@/lib/database/domains/search/accounts'
import { type Db, inTransaction, isInTransaction } from '@/lib/database/kysely'
import { appendPdsAccountStatusEvent } from '@/lib/services/pds/accountEvents'
import { deletePdsBlobFilesBestEffort } from '@/lib/services/pds/blobStorage'

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

const cleanupRejectedPdsBlobFiles = async (
  storageKeys: string[],
  accountId: string
): Promise<void> => {
  if (storageKeys.length === 0) return
  await deletePdsBlobFilesBestEffort(storageKeys, {
    context: {
      accountId,
      reason: 'rejected_pending_account'
    }
  })
}

const rejectPendingAccountInTransaction = async (
  trx: Db,
  { accountId }: RejectPendingAccountParams
): Promise<{ rejected: boolean; pdsBlobStorageKeys: string[] }> => {
  const account = await trx
    .selectFrom('accounts')
    .select('approvedAt')
    .where('id', '=', accountId)
    .limit(1)
    .executeTakeFirst()
  // Reject is only valid for a never-approved (registration-pending)
  // account; an already approved one is left untouched.
  if (!account || account.approvedAt != null) {
    return { rejected: false, pdsBlobStorageKeys: [] }
  }

  const actors = await trx
    .selectFrom('actors')
    .select('id')
    .$narrowType<{ id: string }>()
    .where('accountId', '=', accountId)
    .execute()
  for (const { id } of actors) {
    await deleteActorSearchDocument(trx, { id })
  }
  // `oauthAccessToken.sessionId` and `oauthRefreshToken.sessionId` are
  // foreign keys into `sessions.id` with no ON DELETE action, so a bare
  // delete throws on PostgreSQL (23503) for a session that minted OAuth
  // tokens. The helper detaches the tokens first, in this transaction.
  await deleteSessionsWithTokenDetach(trx, (eb) =>
    eb('accountId', '=', accountId)
  )
  // The account's OAuth grants reference `accounts.id` through `userId` with
  // no ON DELETE action either, so they must go before the account row or
  // PostgreSQL refuses that delete too. A never-approved sign-up has none in
  // practice, but the rejection must not depend on that.
  //
  // This runs BEFORE the actors are deleted: the helper's `referenceId` arm
  // is a subquery over `actors` for this account, so deleting the actors
  // first would leave a grant whose `userId` is null but whose actor is gone
  // behind.
  await revokeAccountOAuthTokens(trx, { accountId })
  // An OAuth client the account registered references `accounts.id` through
  // `userId` with no ON DELETE action. Detach it rather than delete it: the
  // client is an app registration other grants may still name.
  await trx
    .updateTable('oauthClient')
    .set({ userId: null })
    .where('userId', '=', accountId)
    .execute()

  const pdsBlobStorageKeys: string[] = []
  // A never-approved account never federated, so its handles carry no
  // history a remote server could still point at: the rows go with the
  // actors and the usernames become free again. (Unlike deleteActorData,
  // which RETIRES an approved actor's rows so a federated id path is never
  // reissued.)
  if (actors.length > 0) {
    const actorIds = actors.map((actor) => actor.id)
    const pdsRepos = await trx
      .selectFrom('pds_repos')
      .select('did')
      .where('actorId', 'in', actorIds)
      .execute()
    for (const pdsRepo of pdsRepos) {
      const { blobStorageKeys } = await deletePdsRepoData(trx, {
        did: pdsRepo.did
      })
      pdsBlobStorageKeys.push(...blobStorageKeys)
    }

    await trx
      .deleteFrom('actor_handles')
      .where('actorId', 'in', actorIds)
      .execute()
    await trx.deleteFrom('actors').where('id', 'in', actorIds).execute()
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
  await trx.deleteFrom('accounts').where('id', '=', accountId).execute()
  return { rejected: true, pdsBlobStorageKeys }
}

export const rejectPendingAccount = async (
  db: Db,
  params: RejectPendingAccountParams
): Promise<boolean> => {
  const result = await inTransaction(db, (trx) =>
    rejectPendingAccountInTransaction(trx, params)
  )
  if (!isInTransaction(db) && result.rejected) {
    await cleanupRejectedPdsBlobFiles(
      result.pdsBlobStorageKeys,
      params.accountId
    )
  }
  return result.rejected
}

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
 * Whether the actor is still blocked after one moderation flag was cleared:
 * a suspended actor or a disabled account. Used to decide whether clearing
 * suspend or disable should announce the hosted repo as active again.
 */
const isStillModerationBlocked = async (
  trx: Db,
  { actorId, accountId }: { actorId: string; accountId: string | null }
): Promise<boolean> => {
  const actor = await trx
    .selectFrom('actors')
    .select('suspendedAt')
    .where('id', '=', actorId)
    .executeTakeFirst()
  if (actor?.suspendedAt) return true
  if (!accountId) return false
  const account = await trx
    .selectFrom('accounts')
    .select('disabledAt')
    .where('id', '=', accountId)
    .executeTakeFirst()
  return Boolean(account?.disabledAt)
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
export const applyModerationAction = async (
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
): Promise<ApplyModerationActionOutcome> => {
  let pdsBlobStorageKeys: string[] = []

  const outcome = await inTransaction(db, async (trx) => {
    switch (action) {
      case 'suspend':
        await setActorSuspended(trx, {
          actorId: targetActorId,
          suspended: true
        })
        if (accountId) {
          await deleteAllAccountSessions(trx, { accountId })
        }
        await appendPdsAccountStatusEvent(trx, {
          actorId: targetActorId,
          active: false,
          status: 'takendown'
        })
        break
      case 'unsuspend':
        await setActorSuspended(trx, {
          actorId: targetActorId,
          suspended: false
        })
        if (
          !(await isStillModerationBlocked(trx, {
            actorId: targetActorId,
            accountId
          }))
        ) {
          await appendPdsAccountStatusEvent(trx, {
            actorId: targetActorId,
            active: true,
            requireActiveRepo: true
          })
        }
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
        await appendPdsAccountStatusEvent(trx, {
          actorId: targetActorId,
          active: false,
          status: 'takendown'
        })
        break
      case 'enable':
        await setAccountDisabled(trx, {
          accountId: accountId!,
          disabled: false
        })
        if (
          !(await isStillModerationBlocked(trx, {
            actorId: targetActorId,
            accountId
          }))
        ) {
          await appendPdsAccountStatusEvent(trx, {
            actorId: targetActorId,
            active: true,
            requireActiveRepo: true
          })
        }
        break
      case 'approve':
        await approveAccount(trx, { accountId: accountId! })
        break
      case 'reject': {
        const result = await rejectPendingAccountInTransaction(trx, {
          accountId: accountId!
        })
        // An already-approved account is left untouched, and no audit row or
        // report resolution is written for an action that did not apply.
        if (!result.rejected) return { applied: false }
        pdsBlobStorageKeys = result.pdsBlobStorageKeys
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

  if (!isInTransaction(db) && outcome.applied && accountId) {
    await cleanupRejectedPdsBlobFiles(pdsBlobStorageKeys, accountId)
  }

  return outcome
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
  applyModerationAction,
  setReportResolution,
  getAdminAccounts,
  getAdminAccount,
  getAdminAccountRecords,
  getSessionIpsForAccounts
}
