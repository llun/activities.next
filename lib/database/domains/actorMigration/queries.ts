import type { Selectable } from 'kysely'

import type {
  ActorMigration,
  ActorMigrationKind,
  CreateActorMigrationParams,
  GetActorMigrationParams,
  GetActorMigrationsParams,
  GetLastActorMoveParams,
  MarkActorMigrationStartedParams,
  RecordActorMigrationParams,
  RecordActorMigrationResult
} from '@/lib/database/domains/actorMigration/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { ActorMigrations } from '@/lib/database/kysely/db'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import type { ActorSettings } from '@/lib/types/database/rows'
import { actorIdsMatch } from '@/lib/utils/activitypub'

const toActorMigration = (
  row: Selectable<ActorMigrations>
): ActorMigration => ({
  id: row.id,
  actorId: row.actorId,
  targetActorId: row.targetActorId,
  targetAcct: row.targetAcct,
  kind: row.kind as ActorMigrationKind,
  followersCount: row.followersCount,
  createdAt: getCompatibleTime(row.createdAt),
  startedAt: row.startedAt ? getCompatibleTime(row.startedAt) : null
})

// Explicit timestamps: the column default is CURRENT_TIMESTAMP, which SQLite
// stores as a UTC string without a zone.
const insertActorMigration = async (
  db: Db,
  params: CreateActorMigrationParams
): Promise<ActorMigration> => {
  const now = new Date()
  const row = await db
    .insertInto('actor_migrations')
    .values({ ...params, createdAt: now, updatedAt: now })
    .returningAll()
    .executeTakeFirstOrThrow()
  return toActorMigration(row)
}

export const createActorMigration = (
  db: Db,
  params: CreateActorMigrationParams
): Promise<ActorMigration> => insertActorMigration(db, params)

export const recordActorMigration = async (
  db: Db,
  { cooldownMs, aliasVerified, ...params }: RecordActorMigrationParams
): Promise<RecordActorMigrationResult> =>
  inTransaction(db, async (trx) => {
    const actor = await forUpdate(
      trx,
      trx
        .selectFrom('actors')
        .select('settings')
        .where('id', '=', params.actorId)
        .limit(1)
    ).executeTakeFirst()
    if (!actor) return { status: 'no-actor' }
    const settings =
      getCompatibleJSON<ActorSettings>(
        actor.settings as string | ActorSettings
      ) ?? {}

    if (params.kind === 'move') {
      const last = await getLastActorMove(trx, { actorId: params.actorId })
      if (last && last.createdAt + cooldownMs > Date.now()) {
        // The same move again is a retry of a failed publish, and only then:
        // nothing newer than it (a redirect after a DELETE is a new decision),
        // never started, and movedTo still names the target.
        const [newest] = await getActorMigrations(trx, {
          actorId: params.actorId,
          limit: 1
        })
        if (
          newest?.id === last.id &&
          last.startedAt === null &&
          actorIdsMatch(last.targetActorId, params.targetActorId) &&
          settings.movedTo &&
          actorIdsMatch(settings.movedTo, params.targetActorId)
        ) {
          return { status: 'existing', migration: last }
        }
        return { status: 'cooldown', until: last.createdAt + cooldownMs }
      }
      // A new move row is only ever created for an alias the caller verified:
      // the cooldown the caller relied on to skip the check may have ended
      // since it looked.
      if (!aliasVerified) return { status: 'unverified' }
    }

    // A concurrent identical redirect already set the pointer: no second row.
    if (
      params.kind === 'redirect' &&
      settings.movedTo &&
      actorIdsMatch(settings.movedTo, params.targetActorId)
    ) {
      return { status: 'already-moved' }
    }

    const migration = await insertActorMigration(trx, params)
    await trx
      .updateTable('actors')
      .set({
        settings: JSON.stringify({
          ...settings,
          movedTo: params.targetActorId
        }),
        updatedAt: new Date()
      })
      .where('id', '=', params.actorId)
      .execute()
    return { status: 'created', migration }
  })

export const markActorMigrationStarted = async (
  db: Db,
  { id }: MarkActorMigrationStartedParams
): Promise<void> => {
  const now = new Date()
  await db
    .updateTable('actor_migrations')
    .set({ startedAt: now, updatedAt: now })
    .where('id', '=', id)
    .where('startedAt', 'is', null)
    .execute()
}

export const getActorMigration = async (
  db: Db,
  { id, actorId }: GetActorMigrationParams
): Promise<ActorMigration | null> => {
  const row = await db
    .selectFrom('actor_migrations')
    .selectAll()
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .executeTakeFirst()
  return row ? toActorMigration(row) : null
}

export const getActorMigrations = async (
  db: Db,
  { actorId, limit }: GetActorMigrationsParams
): Promise<ActorMigration[]> => {
  let query = db
    .selectFrom('actor_migrations')
    .selectAll()
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
  if (limit !== undefined) query = query.limit(limit)
  return (await query.execute()).map(toActorMigration)
}

export const getLastActorMove = async (
  db: Db,
  { actorId }: GetLastActorMoveParams
): Promise<ActorMigration | null> => {
  const row = await db
    .selectFrom('actor_migrations')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('kind', '=', 'move')
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? toActorMigration(row) : null
}

export const actorMigrationQueries = {
  createActorMigration,
  recordActorMigration,
  markActorMigrationStarted,
  getActorMigration,
  getActorMigrations,
  getLastActorMove
}
