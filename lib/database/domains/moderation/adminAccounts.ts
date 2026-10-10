// The Admin::Account listing and lookups: actor rows paired with their
// account rows, filtered and keyset-paged, plus the session IPs shown with them.
import { type ExpressionBuilder, type SqlBool, sql } from 'kysely'

import { getConfig } from '@/lib/config'
import type {
  AdminAccountIp,
  AdminAccountRecord,
  GetAdminAccountParams,
  GetAdminAccountRecordsParams,
  GetAdminAccountsParams,
  GetSessionIpsForAccountsParams
} from '@/lib/database/domains/moderation/types'
import type { DB, Db } from '@/lib/database/kysely'
import type { EpochMs } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import type { SQLAccount, SQLActor } from '@/lib/types/database/rows'

const getConfiguredHost = (): string => {
  const host = getConfig().host
  return (host.includes('://') ? new URL(host).host : host).toLowerCase()
}

// The admin records hand the raw rows to the Admin::Account serializer, which
// reads them through the SQLActor / SQLAccount row types.
const toActorRow = (row: object) => row as SQLActor
const toAccountRow = (row: object) => row as SQLAccount

// The account rows of `actors`, paired with each actor (null for an actor with
// no account).
const hydrateAdminAccountRecords = async (
  db: Db,
  actors: object[]
): Promise<AdminAccountRecord[]> => {
  const actorRows = actors.map(toActorRow)
  const accountIds = [
    ...new Set(
      actorRows
        .map((actor) => actor.accountId)
        .filter((id): id is string => Boolean(id))
    )
  ]
  const accounts = accountIds.length
    ? await db
        .selectFrom('accounts')
        .selectAll()
        .where('id', 'in', accountIds)
        .execute()
    : []
  const accountById = new Map(
    accounts.map((account) => [account.id, toAccountRow(account)])
  )
  return actorRows.map((actor) => ({
    actor,
    account: actor.accountId ? (accountById.get(actor.accountId) ?? null) : null
  }))
}

// Actors on the far side of the cursor actor in (createdAt, id) order. The
// columns are qualified because the listing joins `accounts`.
const pastAdminCursor = (
  eb: ExpressionBuilder<DB, 'actors' | 'accounts'>,
  cursorCreatedAt: EpochMs,
  cursorId: string,
  operator: '<' | '>'
) => {
  const createdAt = timestampValue(cursorCreatedAt)
  return eb.or([
    eb('actors.createdAt', operator, createdAt),
    eb.and([
      eb('actors.createdAt', '=', createdAt),
      eb('actors.id', operator, cursorId)
    ])
  ])
}

export const getAdminAccounts = async (
  db: Db,
  params: GetAdminAccountsParams
): Promise<AdminAccountRecord[]> => {
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

  // Never list the headless federation signer(s): accountId null on the
  // configured host (remote actors — accountId null on a foreign domain —
  // are still listed). Same predicate as getLocalMastodonActors.
  const configuredHost = getConfiguredHost()
  let query = db
    .selectFrom('actors')
    .leftJoin('accounts', 'actors.accountId', 'accounts.id')
    .selectAll('actors')
    .limit(limit)
    .where((eb) =>
      eb.not(
        eb.and([
          eb('actors.accountId', 'is', null),
          sql<SqlBool>`lower(${sql.ref('actors.domain')}) = ${configuredHost}`
        ])
      )
    )

  if (local) query = query.where('actors.accountId', 'is not', null)
  if (remote) query = query.where('actors.accountId', 'is', null)
  if (active) {
    query = query
      .where('actors.suspendedAt', 'is', null)
      .where('actors.silencedAt', 'is', null)
      .where('accounts.disabledAt', 'is', null)
      .where('accounts.approvedAt', 'is not', null)
  }
  // Pending is a local registration state. Without the accountId guard the
  // left join would make `accounts.approvedAt IS NULL` true for every remote
  // actor (they have no account row), wrongly listing them all as pending.
  if (pending) {
    query = query
      .where('actors.accountId', 'is not', null)
      .where('accounts.approvedAt', 'is', null)
  }
  if (disabled) query = query.where('accounts.disabledAt', 'is not', null)
  if (silenced) query = query.where('actors.silencedAt', 'is not', null)
  if (suspended) query = query.where('actors.suspendedAt', 'is not', null)
  if (sensitized) query = query.where('actors.sensitizedAt', 'is not', null)
  // The text filters bind the pattern as given: `%`, `_` and `\` in a filter
  // are not escaped.
  if (username) {
    query = query.where(
      sql<SqlBool>`lower(${sql.ref('actors.username')}) like ${`%${username.toLowerCase()}%`}`
    )
  }
  if (displayName) {
    query = query.where(
      sql<SqlBool>`lower(${sql.ref('actors.name')}) like ${`%${displayName.toLowerCase()}%`}`
    )
  }
  if (byDomain) {
    query = query.where(
      sql<SqlBool>`lower(${sql.ref('actors.domain')}) = ${byDomain.toLowerCase()}`
    )
  }
  if (email) {
    query = query.where(
      sql<SqlBool>`lower(${sql.ref('accounts.email')}) like ${`%${email.toLowerCase()}%`}`
    )
  }
  if (staff) query = query.where('accounts.role', '=', 'admin')
  if (ip) {
    query = query.where('actors.accountId', 'in', (eb) =>
      eb
        .selectFrom('sessions')
        .select('sessions.accountId')
        .where('sessions.ipAddress', '=', ip)
    )
  }

  const cursorCreatedAt = async (id: string) => {
    const row = await db
      .selectFrom('actors')
      .select('createdAt')
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst()
    return row?.createdAt ?? null
  }

  // Keyset pagination on (createdAt desc, id). max_id/since_id page the newest
  // slice on either side; min_id returns the adjacent (oldest-newer) page
  // ascending then reversed to newest-first.
  if (maxId) {
    const cursor = await cursorCreatedAt(maxId)
    if (cursor != null) {
      query = query.where((eb) => pastAdminCursor(eb, cursor, maxId, '<'))
    }
    const rows = await query
      .orderBy('actors.createdAt', 'desc')
      .orderBy('actors.id', 'desc')
      .execute()
    return hydrateAdminAccountRecords(db, rows)
  }
  if (minId) {
    const cursor = await cursorCreatedAt(minId)
    if (cursor != null) {
      query = query.where((eb) => pastAdminCursor(eb, cursor, minId, '>'))
    }
    const rows = await query
      .orderBy('actors.createdAt', 'asc')
      .orderBy('actors.id', 'asc')
      .execute()
    return hydrateAdminAccountRecords(db, rows.reverse())
  }
  if (sinceId) {
    const cursor = await cursorCreatedAt(sinceId)
    if (cursor != null) {
      query = query.where((eb) => pastAdminCursor(eb, cursor, sinceId, '>'))
    }
    const rows = await query
      .orderBy('actors.createdAt', 'desc')
      .orderBy('actors.id', 'desc')
      .execute()
    return hydrateAdminAccountRecords(db, rows)
  }

  const rows = await query
    .orderBy('actors.createdAt', 'desc')
    .orderBy('actors.id', 'desc')
    .execute()
  return hydrateAdminAccountRecords(db, rows)
}

export const getAdminAccount = async (
  db: Db,
  { actorId }: GetAdminAccountParams
): Promise<AdminAccountRecord | null> => {
  const actor = await db
    .selectFrom('actors')
    .selectAll()
    .where('id', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  if (!actor) return null
  const account = actor.accountId
    ? await db
        .selectFrom('accounts')
        .selectAll()
        .where('id', '=', actor.accountId)
        .limit(1)
        .executeTakeFirst()
    : undefined
  return {
    actor: toActorRow(actor),
    account: account ? toAccountRow(account) : null
  }
}

export const getAdminAccountRecords = async (
  db: Db,
  { actorIds }: GetAdminAccountRecordsParams
): Promise<AdminAccountRecord[]> => {
  const uniqueIds = [...new Set(actorIds)]
  if (uniqueIds.length === 0) return []

  const actors = await db
    .selectFrom('actors')
    .selectAll()
    .where('id', 'in', uniqueIds)
    .execute()
  return hydrateAdminAccountRecords(db, actors)
}

export const getSessionIpsForAccounts = async (
  db: Db,
  { accountIds }: GetSessionIpsForAccountsParams
): Promise<Map<string, AdminAccountIp[]>> => {
  const result = new Map<string, AdminAccountIp[]>()
  const uniqueIds = [...new Set(accountIds)]
  if (uniqueIds.length === 0) return result

  const rows = await db
    .selectFrom('sessions')
    .select(['accountId', 'ipAddress', 'updatedAt'])
    .$narrowType<{ accountId: string; ipAddress: string; updatedAt: EpochMs }>()
    .where('accountId', 'in', uniqueIds)
    .where('ipAddress', 'is not', null)
    .orderBy('updatedAt', 'desc')
    .execute()

  for (const row of rows) {
    const list = result.get(row.accountId) ?? []
    // Keep one entry per distinct ip, with its latest use (rows are already
    // newest-first, so the first occurrence wins).
    if (!list.some((entry) => entry.ip === row.ipAddress)) {
      list.push({ ip: row.ipAddress, usedAt: row.updatedAt })
    }
    result.set(row.accountId, list)
  }
  return result
}
