import type { Selectable } from 'kysely'

import type {
  ActorMigration,
  ActorMigrationKind,
  CreateActorMigrationParams,
  GetActorMigrationsParams,
  GetLastActorMoveParams
} from '@/lib/database/domains/actorMigration/types'
import type { Db } from '@/lib/database/kysely'
import type { ActorMigrations } from '@/lib/database/kysely/db'

const toActorMigration = (
  row: Selectable<ActorMigrations>
): ActorMigration => ({
  id: row.id,
  actorId: row.actorId,
  targetActorId: row.targetActorId,
  targetAcct: row.targetAcct,
  kind: row.kind as ActorMigrationKind,
  followersCount: row.followersCount,
  createdAt: new Date(row.createdAt).getTime()
})

export const createActorMigration = async (
  db: Db,
  params: CreateActorMigrationParams
): Promise<ActorMigration> => {
  const row = await db
    .insertInto('actor_migrations')
    .values(params)
    .returningAll()
    .executeTakeFirstOrThrow()
  return toActorMigration(row)
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
  getActorMigrations,
  getLastActorMove
}
