import { randomUUID } from 'node:crypto'

import type {
  GetAccountNoteParams,
  UpsertAccountNoteParams
} from '@/lib/database/domains/accountNote/types'
import type { Db } from '@/lib/database/kysely'

export const upsertAccountNote = async (
  db: Db,
  { actorId, targetActorId, comment }: UpsertAccountNoteParams
): Promise<string> => {
  const trimmed = comment.trim()
  const currentTime = new Date()

  // An empty comment clears the note (Mastodon semantics).
  if (trimmed === '') {
    await db
      .deleteFrom('account_notes')
      .where('actorId', '=', actorId)
      .where('targetActorId', '=', targetActorId)
      .execute()
    return ''
  }

  // Idempotent upsert on the (actorId, targetActorId) unique index. A single
  // statement keeps this race-condition safe under concurrent requests and
  // avoids the extra roundtrip.
  await db
    .insertInto('account_notes')
    .values({
      id: randomUUID(),
      actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      comment: trimmed,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((oc) =>
      oc
        .columns(['actorId', 'targetActorId'])
        .doUpdateSet({ comment: trimmed, updatedAt: currentTime })
    )
    .execute()
  return trimmed
}

export const getAccountNote = async (
  db: Db,
  { actorId, targetActorId }: GetAccountNoteParams
): Promise<string> => {
  const data = await db
    .selectFrom('account_notes')
    .select('comment')
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .limit(1)
    .executeTakeFirst()
  return typeof data?.comment === 'string' ? data.comment : ''
}

export const accountNoteQueries = { upsertAccountNote, getAccountNote }
