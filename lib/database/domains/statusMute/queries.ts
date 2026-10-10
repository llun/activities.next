import type {
  CreateStatusMuteParams,
  DeleteStatusMuteParams,
  GetActorMutedConversationRootIdsParams,
  IsConversationMutedParams
} from '@/lib/database/domains/statusMute/types'
import type { Db } from '@/lib/database/kysely'

export const createStatusMute = async (
  db: Db,
  { actorId, statusId }: CreateStatusMuteParams
): Promise<void> => {
  // Atomic insert-or-ignore: muting an already-muted conversation is a no-op
  // and safe under concurrent calls, without a separate existence query.
  const currentTime = new Date()
  await db
    .insertInto('status_mutes')
    .values({
      actorId,
      statusId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((oc) => oc.columns(['actorId', 'statusId']).doNothing())
    .execute()
}

export const deleteStatusMute = async (
  db: Db,
  { actorId, statusId }: DeleteStatusMuteParams
): Promise<void> => {
  await db
    .deleteFrom('status_mutes')
    .where('actorId', '=', actorId)
    .where('statusId', '=', statusId)
    .execute()
}

export const isConversationMuted = async (
  db: Db,
  { actorId, statusId }: IsConversationMutedParams
): Promise<boolean> => {
  const row = await db
    .selectFrom('status_mutes')
    .select('statusId')
    .where('actorId', '=', actorId)
    .where('statusId', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

export const getActorMutedConversationRootIds = async (
  db: Db,
  { actorId }: GetActorMutedConversationRootIdsParams
): Promise<string[]> => {
  const rows = await db
    .selectFrom('status_mutes')
    .select('statusId')
    .where('actorId', '=', actorId)
    .execute()
  return rows.map((row) => row.statusId)
}

export const statusMuteQueries = {
  createStatusMute,
  deleteStatusMute,
  isConversationMuted,
  getActorMutedConversationRootIds
}
