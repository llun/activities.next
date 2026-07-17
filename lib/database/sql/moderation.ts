import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getConfig } from '@/lib/config'
import { deleteActorSearchDocument } from '@/lib/database/sql/search'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  AdminAccountDatabase,
  AdminAccountIp,
  AdminAccountRecord,
  CreateModerationActionParams,
  GetAdminAccountParams,
  GetAdminAccountsParams,
  GetModerationStatesForActorsParams,
  GetSessionIpsForAccountsParams,
  ModerationAction,
  ModerationDatabase,
  ModerationStates,
  SetAccountDisabledParams,
  SetActorSensitizedParams,
  SetActorSilencedParams,
  SetActorSuspendedParams
} from '@/lib/types/database/operations'
import { SQLAccount, SQLActor } from '@/lib/types/database/rows'

type SQLModerationStateRow = {
  id: string
  suspendedAt: number | Date | null
  silencedAt: number | Date | null
  sensitizedAt: number | Date | null
}

const toTimeOrNull = (
  value: number | Date | null | undefined
): number | null => (value != null ? getCompatibleTime(value) : null)

const getConfiguredHost = (): string => {
  const host = getConfig().host
  return (host.includes('://') ? new URL(host).host : host).toLowerCase()
}

export const ModerationSQLDatabaseMixin = (
  database: Knex
): ModerationDatabase & AdminAccountDatabase => ({
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
  },

  async setReportResolution({
    reportId,
    resolved,
    actionTakenByActorId = null
  }) {
    const updated = await database('reports')
      .where('id', reportId)
      .update(
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
    return updated > 0
  },

  async getAdminAccounts(
    params: GetAdminAccountsParams
  ): Promise<AdminAccountRecord[]> {
    const {
      limit = 100,
      local,
      remote,
      active,
      pending,
      disabled,
      silenced,
      suspended,
      sensitized,
      username,
      displayName,
      byDomain,
      email,
      ip,
      staff,
      maxId,
      minId,
      sinceId
    } = params

    const query = database<SQLActor>('actors')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .select('actors.*')
      .limit(limit)

    // Never list the headless federation signer(s): accountId null on the
    // configured host (remote actors — accountId null on a foreign domain —
    // are still listed). Same predicate as getLocalMastodonActors.
    const configuredHost = getConfiguredHost()
    query.whereNot(function () {
      this.whereNull('actors.accountId').whereRaw('lower(actors.domain) = ?', [
        configuredHost
      ])
    })

    if (local) query.whereNotNull('actors.accountId')
    if (remote) query.whereNull('actors.accountId')
    if (active) {
      query
        .whereNull('actors.suspendedAt')
        .whereNull('actors.silencedAt')
        .whereNull('accounts.disabledAt')
        .whereNotNull('accounts.approvedAt')
    }
    // Pending is a local registration state. Without the accountId guard the
    // leftJoin would make `accounts.approvedAt IS NULL` true for every remote
    // actor (they have no account row), wrongly listing them all as pending.
    if (pending) {
      query.whereNotNull('actors.accountId').whereNull('accounts.approvedAt')
    }
    if (disabled) query.whereNotNull('accounts.disabledAt')
    if (silenced) query.whereNotNull('actors.silencedAt')
    if (suspended) query.whereNotNull('actors.suspendedAt')
    if (sensitized) query.whereNotNull('actors.sensitizedAt')
    if (username) {
      query.whereRaw('lower(actors.username) like ?', [
        `%${username.toLowerCase()}%`
      ])
    }
    if (displayName) {
      query.whereRaw('lower(actors.name) like ?', [
        `%${displayName.toLowerCase()}%`
      ])
    }
    if (byDomain)
      query.whereRaw('lower(actors.domain) = ?', [byDomain.toLowerCase()])
    if (email) {
      query.whereRaw('lower(accounts.email) like ?', [
        `%${email.toLowerCase()}%`
      ])
    }
    if (staff) query.where('accounts.role', 'admin')
    if (ip) {
      query.whereIn('actors.accountId', function () {
        this.select('accountId').from('sessions').where('ipAddress', ip)
      })
    }

    const cursorCreatedAt = async (id: string) => {
      const row = await database<SQLActor>('actors')
        .where('id', id)
        .select('createdAt')
        .first()
      return row?.createdAt ?? null
    }

    const hydrate = async (
      actors: SQLActor[]
    ): Promise<AdminAccountRecord[]> => {
      const accountIds = [
        ...new Set(
          actors
            .map((actor) => actor.accountId)
            .filter((id): id is string => Boolean(id))
        )
      ]
      const accounts = accountIds.length
        ? await database<SQLAccount>('accounts').whereIn('id', accountIds)
        : []
      const accountById = new Map(accounts.map((a) => [a.id, a]))
      return actors.map((actor) => ({
        actor,
        account: actor.accountId
          ? (accountById.get(actor.accountId) ?? null)
          : null
      }))
    }

    // Keyset pagination on (createdAt desc, id). max_id/since_id page the newest
    // slice on either side; min_id returns the adjacent (oldest-newer) page
    // ascending then reversed to newest-first.
    if (maxId) {
      const cursor = await cursorCreatedAt(maxId)
      if (cursor != null) {
        query.where(function () {
          this.where('actors.createdAt', '<', cursor).orWhere(function () {
            this.where('actors.createdAt', cursor).where(
              'actors.id',
              '<',
              maxId
            )
          })
        })
      }
      return hydrate(
        await query
          .orderBy('actors.createdAt', 'desc')
          .orderBy('actors.id', 'desc')
      )
    }
    if (minId) {
      const cursor = await cursorCreatedAt(minId)
      if (cursor != null) {
        query.where(function () {
          this.where('actors.createdAt', '>', cursor).orWhere(function () {
            this.where('actors.createdAt', cursor).where(
              'actors.id',
              '>',
              minId
            )
          })
        })
      }
      const rows = await query
        .orderBy('actors.createdAt', 'asc')
        .orderBy('actors.id', 'asc')
      return hydrate(rows.reverse())
    }
    if (sinceId) {
      const cursor = await cursorCreatedAt(sinceId)
      if (cursor != null) {
        query.where(function () {
          this.where('actors.createdAt', '>', cursor).orWhere(function () {
            this.where('actors.createdAt', cursor).where(
              'actors.id',
              '>',
              sinceId
            )
          })
        })
      }
      return hydrate(
        await query
          .orderBy('actors.createdAt', 'desc')
          .orderBy('actors.id', 'desc')
      )
    }

    return hydrate(
      await query
        .orderBy('actors.createdAt', 'desc')
        .orderBy('actors.id', 'desc')
    )
  },

  async getAdminAccount({
    actorId
  }: GetAdminAccountParams): Promise<AdminAccountRecord | null> {
    const actor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!actor) return null
    const account = actor.accountId
      ? ((await database<SQLAccount>('accounts')
          .where('id', actor.accountId)
          .first()) ?? null)
      : null
    return { actor, account }
  },

  async getSessionIpsForAccounts({
    accountIds
  }: GetSessionIpsForAccountsParams): Promise<Map<string, AdminAccountIp[]>> {
    const result = new Map<string, AdminAccountIp[]>()
    const uniqueIds = [...new Set(accountIds)]
    if (uniqueIds.length === 0) return result

    const rows = await database('sessions')
      .whereIn('accountId', uniqueIds)
      .whereNotNull('ipAddress')
      .orderBy('updatedAt', 'desc')
      .select<
        { accountId: string; ipAddress: string; updatedAt: number | Date }[]
      >('accountId', 'ipAddress', 'updatedAt')

    for (const row of rows) {
      const list = result.get(row.accountId) ?? []
      // Keep one entry per distinct ip, with its latest use (rows are already
      // newest-first, so the first occurrence wins).
      if (!list.some((entry) => entry.ip === row.ipAddress)) {
        list.push({
          ip: row.ipAddress,
          usedAt: getCompatibleTime(row.updatedAt)
        })
      }
      result.set(row.accountId, list)
    }
    return result
  }
})
