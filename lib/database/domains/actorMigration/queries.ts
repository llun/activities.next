import type { Selectable } from 'kysely'

import type {
  ActorMigration,
  ActorMigrationKind,
  CreateActorMigrationParams,
  GetActorMigrationsParams,
  GetLastActorMoveParams,
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
  createdAt: getCompatibleTime(row.createdAt)
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
  { cooldownMs, ...params }: RecordActorMigrationParams
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
        // The same move again (a retry after a failed publish) is not a new one.
        if (
          actorIdsMatch(last.targetActorId, params.targetActorId) &&
          settings.movedTo &&
          actorIdsMatch(settings.movedTo, params.targetActorId)
        ) {
          return { status: 'existing', migration: last }
        }
        return { status: 'cooldown', until: last.createdAt + cooldownMs }
      }
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
  getActorMigrations,
  getLastActorMove
}
