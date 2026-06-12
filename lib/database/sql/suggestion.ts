import { Knex } from 'knex'

import {
  DismissSuggestionParams,
  FriendsOfFriendsSuggestion,
  GetFriendsOfFriendsSuggestionsParams,
  SuggestionDatabase
} from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'

type SQLFriendsOfFriendsRow = {
  targetActorId: string
  // count() comes back as a string on Postgres but a number on SQLite.
  mutuals: number | string
}

export const SuggestionSQLDatabaseMixin = (
  database: Knex
): SuggestionDatabase => ({
  async getFriendsOfFriendsSuggestions({
    actorId,
    limit
  }: GetFriendsOfFriendsSuggestionsParams) {
    // f1: who actorId follows; f2: who those accounts follow. Only Accepted
    // edges count on both hops. A candidate is excluded when the actor already
    // follows it, has a pending follow request to it, has dismissed it, is in a
    // block with it (either direction), or has an active mute on it. Filtering
    // here — BEFORE LIMIT — mirrors applyBlockMuteFilter so the page is never
    // returned short (Undo/Rejected follows remain suggestable).
    const now = Date.now()
    const rows = (await database('follows as f1')
      .join('follows as f2', function () {
        this.on('f2.actorId', 'f1.targetActorId').andOnVal(
          'f2.status',
          FollowStatus.enum.Accepted
        )
      })
      .where('f1.actorId', actorId)
      .where('f1.status', FollowStatus.enum.Accepted)
      .whereNot('f2.targetActorId', actorId)
      .whereNotIn('f2.targetActorId', function () {
        this.select('targetActorId')
          .from('follows')
          .where('actorId', actorId)
          .whereIn('status', [
            FollowStatus.enum.Accepted,
            FollowStatus.enum.Requested
          ])
      })
      .whereNotIn('f2.targetActorId', function () {
        this.select('targetActorId')
          .from('suggestion_dismissals')
          .where({ actorId })
      })
      // Blocks are bidirectional: drop a candidate the actor blocks OR who
      // blocks the actor. Two separate clauses so each can use its own
      // (actorId|targetActorId) index on the blocks table.
      .whereNotIn('f2.targetActorId', function () {
        this.select('targetActorId').from('blocks').where('actorId', actorId)
      })
      .whereNotIn('f2.targetActorId', function () {
        this.select('actorId').from('blocks').where('targetActorId', actorId)
      })
      // Mutes are one-directional (only what the actor mutes) and expire: a
      // mute is active while endsAt IS NULL or endsAt > now.
      .whereNotIn('f2.targetActorId', function () {
        this.select('targetActorId')
          .from('mutes')
          .where('actorId', actorId)
          .andWhere(function () {
            this.whereNull('endsAt').orWhere('endsAt', '>', now)
          })
      })
      .groupBy('f2.targetActorId')
      .select('f2.targetActorId as targetActorId')
      .count({ mutuals: '*' })
      .orderBy([
        { column: 'mutuals', order: 'desc' },
        { column: 'targetActorId' }
      ])
      .limit(limit)) as SQLFriendsOfFriendsRow[]

    return rows.map(
      (row): FriendsOfFriendsSuggestion => ({
        targetActorId: row.targetActorId,
        mutuals: Number(row.mutuals)
      })
    )
  },

  async dismissSuggestion({ actorId, targetActorId }: DismissSuggestionParams) {
    // Idempotent: ignore on the (actorId, targetActorId) primary key so a
    // repeat dismissal of the same pair is a no-op instead of an error.
    await database('suggestion_dismissals')
      .insert({ actorId, targetActorId, createdAt: new Date() })
      .onConflict(['actorId', 'targetActorId'])
      .ignore()
  }
})
