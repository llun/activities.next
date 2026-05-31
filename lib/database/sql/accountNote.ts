import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import {
  AccountNoteDatabase,
  GetAccountNoteParams,
  UpsertAccountNoteParams
} from '@/lib/types/database/operations'

export const AccountNoteSQLDatabaseMixin = (
  database: Knex
): AccountNoteDatabase => ({
  async upsertAccountNote({
    actorId,
    targetActorId,
    comment
  }: UpsertAccountNoteParams) {
    const trimmed = comment.trim()
    const currentTime = new Date()

    // An empty comment clears the note (Mastodon semantics).
    if (trimmed === '') {
      await database('account_notes').where({ actorId, targetActorId }).del()
      return ''
    }

    // Idempotent upsert on the (actorId, targetActorId) unique index. Using
    // onConflict().merge() (instead of select-then-insert/update) keeps this
    // race-condition safe under concurrent requests and avoids the extra
    // roundtrip.
    await database('account_notes')
      .insert({
        id: randomUUID(),
        actorId,
        actorHost: new URL(actorId).host,
        targetActorId,
        targetActorHost: new URL(targetActorId).host,
        comment: trimmed,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict(['actorId', 'targetActorId'])
      .merge({ comment: trimmed, updatedAt: currentTime })
    return trimmed
  },

  async getAccountNote({ actorId, targetActorId }: GetAccountNoteParams) {
    const data = await database('account_notes')
      .where({ actorId, targetActorId })
      .first()
    return typeof data?.comment === 'string' ? data.comment : ''
  }
})
