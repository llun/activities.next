import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { deleteActorSearchDocument } from '@/lib/database/sql/search'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateModerationActionParams,
  GetModerationStatesForActorsParams,
  ModerationAction,
  ModerationDatabase,
  ModerationStates,
  SetAccountDisabledParams,
  SetActorSensitizedParams,
  SetActorSilencedParams,
  SetActorSuspendedParams
} from '@/lib/types/database/operations'

type SQLModerationStateRow = {
  id: string
  suspendedAt: number | Date | null
  silencedAt: number | Date | null
  sensitizedAt: number | Date | null
}

const toTimeOrNull = (
  value: number | Date | null | undefined
): number | null => (value != null ? getCompatibleTime(value) : null)

export const ModerationSQLDatabaseMixin = (
  database: Knex
): ModerationDatabase => ({
  async setActorSuspended({ actorId, suspended }: SetActorSuspendedParams) {
    await database('actors')
      .where('id', actorId)
      .update({ suspendedAt: suspended ? new Date() : null })
  },

  async setActorSilenced({ actorId, silenced }: SetActorSilencedParams) {
    await database('actors')
      .where('id', actorId)
      .update({ silencedAt: silenced ? new Date() : null })
  },

  async setActorSensitized({ actorId, sensitized }: SetActorSensitizedParams) {
    await database('actors')
      .where('id', actorId)
      .update({ sensitizedAt: sensitized ? new Date() : null })
  },

  async setAccountDisabled({ accountId, disabled }: SetAccountDisabledParams) {
    await database('accounts')
      .where('id', accountId)
      .update({ disabledAt: disabled ? new Date() : null })
  },

  async approveAccount({ accountId }) {
    // Idempotent: only stamp when currently pending so a re-approval preserves
    // the original approval time.
    await database('accounts')
      .where('id', accountId)
      .whereNull('approvedAt')
      .update({ approvedAt: new Date() })
  },

  async rejectPendingAccount({ accountId }) {
    return database.transaction(async (trx) => {
      const account = await trx('accounts')
        .where('id', accountId)
        .first<{ approvedAt: number | Date | null } | undefined>('approvedAt')
      // Reject is only valid for a never-approved (registration-pending)
      // account; an already approved one is left untouched.
      if (!account || account.approvedAt != null) return false

      const actors = await trx('actors')
        .where('accountId', accountId)
        .select<{ id: string }[]>('id')
      for (const { id } of actors) {
        await deleteActorSearchDocument(trx, { id })
      }
      if (actors.length > 0) {
        await trx('actors')
          .whereIn(
            'id',
            actors.map((actor) => actor.id)
          )
          .delete()
      }
      await trx('account_providers').where('accountId', accountId).delete()
      await trx('sessions').where('accountId', accountId).delete()
      await trx('accounts').where('id', accountId).delete()
      return true
    })
  },

  async getModerationStatesForActors({
    actorIds
  }: GetModerationStatesForActorsParams) {
    const states = new Map<string, ModerationStates>()
    const uniqueIds = [...new Set(actorIds)]
    if (uniqueIds.length === 0) return states

    const rows = await database<SQLModerationStateRow>('actors')
      .whereIn('id', uniqueIds)
      .select('id', 'suspendedAt', 'silencedAt', 'sensitizedAt')

    for (const row of rows) {
      const suspendedAt = toTimeOrNull(row.suspendedAt)
      const silencedAt = toTimeOrNull(row.silencedAt)
      const sensitizedAt = toTimeOrNull(row.sensitizedAt)
      // Only moderated actors get a map entry, so a missing entry unambiguously
      // means "not moderated" for callers (the timeline filter, inbox drops).
      if (
        suspendedAt === null &&
        silencedAt === null &&
        sensitizedAt === null
      ) {
        continue
      }
      states.set(row.id, { suspendedAt, silencedAt, sensitizedAt })
    }
    return states
  },

  async createModerationAction({
    targetActorId,
    moderatorAccountId,
    moderatorActorId = null,
    action,
    reportId = null,
    text = ''
  }: CreateModerationActionParams): Promise<ModerationAction> {
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
    await database('moderation_actions').insert(row)
    return {
      ...row,
      moderatorActorId: moderatorActorId ?? null,
      reportId: reportId ?? null,
      createdAt: getCompatibleTime(currentTime)
    }
  },

  async deleteAllAccountSessions({ accountId }) {
    await database('sessions').where('accountId', accountId).delete()
  }
})
