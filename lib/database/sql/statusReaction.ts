import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import { MAX_REACTIONS_PER_ACTOR } from '@/lib/services/statuses/reactionLimits'
import {
  CreateStatusReactionParams,
  DeleteStatusReactionParams,
  GetStatusReactionActorsParams,
  GetStatusReactionRollupsParams,
  StatusReactionActor,
  StatusReactionDatabase,
  StatusReactionRollup
} from '@/lib/types/database/operations'

// count()/max() come back as strings on Postgres but numbers on SQLite.
type SQLStatusReactionRollupRow = {
  statusId: string
  name: string
  count: number | string
  mine: number | string
  reactionUrl: string | null
  firstReactedAt: number | Date | string
}

type SQLStatusReactionActorRow = {
  name: string
  actorId: string
  createdAt: number | Date | string
}

// Every remote custom-emoji reaction is namespaced `shortcode@domain` by
// `resolveReactionEmoji` — including one the sender wrote without colons — so a
// stored name without the separator is either a unicode emoji (which never
// matches a shortcode) or a genuinely *local* shortcode, whose image resolves
// live from `customEmojis` so an admin re-upload propagates to existing chips.
const isLocalShortcodeCandidate = (name: string) => !name.includes('@')

export const StatusReactionSQLDatabaseMixin = (
  database: Knex
): StatusReactionDatabase => ({
  async createStatusReaction({
    statusId,
    actorId,
    name,
    url
  }: CreateStatusReactionParams) {
    return database.transaction(async (trx) => {
      const status = await trx('statuses').where('id', statusId).first('id')
      if (!status) return false

      // The actor's existing reactions on this status, capped at 8, so one
      // query answers both "already reacted with this name?" and "at the cap?".
      const existing = await trx('status_reactions')
        .where({ statusId, actorId })
        .select<{ name: string }[]>('name')
      // Re-reacting with a name already stored is an idempotent no-op, not an
      // overflow. A genuine overflow drops the new reaction rather than evicting
      // an earlier one: eviction would desynchronise us from the sender, which
      // still believes the evicted reaction stands.
      if (existing.some((row) => row.name === name)) return false
      if (existing.length >= MAX_REACTIONS_PER_ACTOR) return false

      const currentTime = new Date()
      const inserted = await trx('status_reactions')
        .insert({
          statusId,
          actorId,
          name,
          url: url ?? null,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .onConflict(['statusId', 'actorId', 'name'])
        .ignore()
      // A concurrent writer can win the race between the read above and this
      // insert; `onConflict().ignore()` then reports zero affected rows, so the
      // caller still learns nothing changed and skips the notification.
      return Array.isArray(inserted) ? inserted.length > 0 : Boolean(inserted)
    })
  },

  async deleteStatusReaction({
    statusId,
    actorId,
    name
  }: DeleteStatusReactionParams) {
    const deleted = await database('status_reactions')
      .where({ statusId, actorId, name })
      .delete()
    return deleted > 0
  },

  async getStatusReactionRollups({
    statusIds,
    currentActorId
  }: GetStatusReactionRollupsParams) {
    const uniqueStatusIds = [...new Set(statusIds)]
    if (uniqueStatusIds.length === 0) return []

    // `mine` is 1 when the querying actor is among the reactors for this
    // (statusId, name) group. MAX over a per-row CASE is portable across SQLite
    // and PostgreSQL — the same shape getAnnouncementReactions uses. An absent
    // currentActorId can never match a stored actor id, so `me` is always false.
    const meActorId = currentActorId ?? ''
    const rowChunks = await Promise.all(
      chunkArray(uniqueStatusIds, getWhereInBatchSize(database, 1)).map(
        async (chunk) =>
          (await database('status_reactions')
            .whereIn('statusId', chunk)
            .groupBy('statusId', 'name')
            .select('statusId', 'name')
            .count({ count: '*' })
            .max({
              mine: database.raw('CASE WHEN ?? = ? THEN 1 ELSE 0 END', [
                'actorId',
                meActorId
              ])
            })
            // Only remote custom emoji store a url, and every row for one
            // (statusId, name) carries the same one, so MAX just unwraps it.
            .max({ reactionUrl: 'url' })
            .min({ firstReactedAt: 'createdAt' })
            // Pleroma orders reactions by first-reaction time ascending; `name`
            // only breaks ties so the order is stable.
            .orderBy('firstReactedAt', 'asc')
            .orderBy('name', 'asc')) as SQLStatusReactionRollupRow[]
      )
    )
    const rows = rowChunks.flat()

    const localShortcodes = [
      ...new Set(
        rows
          .filter(
            (row) => !row.reactionUrl && isLocalShortcodeCandidate(row.name)
          )
          .map((row) => row.name)
      )
    ]
    // A disabled custom emoji stops rendering as an image and falls back to its
    // shortcode text, matching how the picker and emoji list treat it.
    const localEmojiChunks = localShortcodes.length
      ? await Promise.all(
          chunkArray(localShortcodes, getWhereInBatchSize(database, 1)).map(
            (chunk) =>
              database('customEmojis')
                .whereIn('shortcode', chunk)
                .where('disabled', false)
                .select<
                  { shortcode: string; url: string; staticUrl: string }[]
                >('shortcode', 'url', 'staticUrl')
          )
        )
      : []
    const localEmojis = new Map(
      localEmojiChunks
        .flat()
        .map((emoji) => [
          emoji.shortcode,
          { url: emoji.url, staticUrl: emoji.staticUrl }
        ])
    )

    return rows.map((row): StatusReactionRollup => {
      const localEmoji = row.reactionUrl ? undefined : localEmojis.get(row.name)
      return {
        statusId: row.statusId,
        name: row.name,
        count: Number(row.count),
        me: Number(row.mine) === 1,
        // Remote custom emoji have no separate static variant, so the stored
        // animated url doubles as `static_url` (Mastodon requires both).
        url: row.reactionUrl ?? localEmoji?.url ?? null,
        staticUrl: row.reactionUrl ?? localEmoji?.staticUrl ?? null
      }
    })
  },

  async getStatusReactionActors({
    statusId,
    name
  }: GetStatusReactionActorsParams) {
    const query = database('status_reactions').where('statusId', statusId)
    if (name !== undefined) query.where('name', name)

    const rows = (await query
      .select('name', 'actorId', 'createdAt')
      .orderBy('createdAt', 'asc')
      .orderBy('actorId', 'asc')) as SQLStatusReactionActorRow[]

    return rows.map((row): StatusReactionActor => ({
      name: row.name,
      actorId: row.actorId,
      createdAt: getCompatibleTime(row.createdAt)
    }))
  }
})
