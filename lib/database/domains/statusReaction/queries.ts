import { sql } from 'kysely'

import type {
  CreateStatusReactionParams,
  DeleteStatusReactionParams,
  GetStatusReactionActorsParams,
  GetStatusReactionRollupsParams,
  StatusReactionActor,
  StatusReactionRollup
} from '@/lib/database/domains/statusReaction/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { MAX_REACTIONS_PER_ACTOR } from '@/lib/services/statuses/reactionLimits'

// Every remote custom-emoji reaction is namespaced `shortcode@domain` by
// `resolveReactionEmoji` — including one the sender wrote without colons — so a
// stored name without the separator is either a unicode emoji (which never
// matches a shortcode) or a genuinely *local* shortcode, whose image resolves
// live from `customEmojis` so an admin re-upload propagates to existing chips.
const isLocalShortcodeCandidate = (name: string) => !name.includes('@')

export const createStatusReaction = (
  db: Db,
  { statusId, actorId, name, url }: CreateStatusReactionParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    // Row-lock the status so concurrent reactions to it run one at a time on
    // PostgreSQL (SQLite writers already serialize, and has no row locks, so
    // forUpdate() leaves the lock out there). The cap below is a
    // read-then-insert, and the unique key includes the name, so without this
    // a burst of DISTINCT names from one actor each reads fewer than
    // MAX_REACTIONS_PER_ACTOR rows and they all insert, leaving the actor far
    // over the cap.
    const status = await forUpdate(
      trx,
      trx
        .selectFrom('statuses')
        .select('id')
        .where('id', '=', statusId)
        .limit(1)
    ).executeTakeFirst()
    if (!status) return false

    // The actor's existing reactions on this status, capped at 8, so one
    // query answers both "already reacted with this name?" and "at the cap?".
    const existing = await trx
      .selectFrom('status_reactions')
      .select('name')
      .where('statusId', '=', statusId)
      .where('actorId', '=', actorId)
      .execute()
    // Re-reacting with a name already stored is an idempotent no-op, not an
    // overflow. A genuine overflow drops the new reaction rather than evicting
    // an earlier one: eviction would desynchronise us from the sender, which
    // still believes the evicted reaction stands.
    if (existing.some((row) => row.name === name)) return false
    if (existing.length >= MAX_REACTIONS_PER_ACTOR) return false

    const currentTime = new Date()
    await trx
      .insertInto('status_reactions')
      .values({
        statusId,
        actorId,
        name,
        url: url ?? null,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((oc) =>
        oc.columns(['statusId', 'actorId', 'name']).doNothing()
      )
      .execute()
    // The read above already established the row did not exist, so this is a
    // real state change. `onConflict().doNothing()` only covers a writer that
    // won the race in between — at worst one duplicate notification, the same
    // exposure `createLike`'s identical read-then-insert has always had.
    return true
  })

export const deleteStatusReaction = async (
  db: Db,
  { statusId, actorId, name }: DeleteStatusReactionParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('status_reactions')
    .where('statusId', '=', statusId)
    .where('actorId', '=', actorId)
    .where('name', '=', name)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

export const getStatusReactionRollups = async (
  db: Db,
  { statusIds, currentActorId }: GetStatusReactionRollupsParams
): Promise<StatusReactionRollup[]> => {
  const uniqueStatusIds = [...new Set(statusIds)]
  if (uniqueStatusIds.length === 0) return []

  // `mine` is 1 when the querying actor is among the reactors for this
  // (statusId, name) group. MAX over a per-row CASE is portable across SQLite
  // and PostgreSQL — the same shape getAnnouncementReactions uses. An absent
  // currentActorId can never match a stored actor id, so `me` is always false.
  const meActorId = currentActorId ?? ''
  const rows = await selectInChunks(
    db,
    uniqueStatusIds,
    (chunk) =>
      db
        .selectFrom('status_reactions')
        .where('statusId', 'in', chunk)
        .groupBy(['statusId', 'name'])
        .select(['statusId', 'name'])
        .select((eb) => [
          eb.fn.countAll().as('count'),
          eb.fn
            .max(
              sql<number>`case when ${eb.ref('actorId')} = ${meActorId} then 1 else 0 end`
            )
            .as('mine'),
          // Only remote custom emoji store a url, and a name is namespaced
          // to the one instance allowed to supply its image
          // (`ownsReactionNamespace`), so the rows in a group agree except
          // when that instance re-uploads its emoji at a new url — MAX then
          // just picks one of its own. It can never surface another peer's.
          eb.fn.max('url').as('reactionUrl'),
          eb.fn.min('createdAt').as('firstReactedAt')
        ])
        // Pleroma orders reactions by first-reaction time ascending; `name`
        // only breaks ties so the order is stable.
        .orderBy('firstReactedAt', 'asc')
        .orderBy('name', 'asc')
        .execute(),
    1
  )

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
  const localEmojiRows = localShortcodes.length
    ? await selectInChunks(
        db,
        localShortcodes,
        (chunk) =>
          db
            .selectFrom('customEmojis')
            .select(['shortcode', 'url', 'staticUrl'])
            .where('shortcode', 'in', chunk)
            .where('disabled', '=', false)
            .execute(),
        1
      )
    : []
  const localEmojis = new Map(
    localEmojiRows.map((emoji) => [
      emoji.shortcode,
      { url: emoji.url, staticUrl: emoji.staticUrl }
    ])
  )

  return rows.map((row): StatusReactionRollup => {
    const localEmoji = row.reactionUrl ? undefined : localEmojis.get(row.name)
    return {
      statusId: row.statusId,
      name: row.name,
      // count(*) and max(case ...) have no declared column type, so SQLite
      // hands them back as is.
      count: Number(row.count),
      me: Number(row.mine) === 1,
      // Remote custom emoji have no separate static variant, so the stored
      // animated url doubles as `static_url` (Mastodon requires both).
      url: row.reactionUrl ?? localEmoji?.url ?? null,
      staticUrl: row.reactionUrl ?? localEmoji?.staticUrl ?? null
    }
  })
}

export const getStatusReactionActors = async (
  db: Db,
  { statusId, name }: GetStatusReactionActorsParams
): Promise<StatusReactionActor[]> => {
  let query = db
    .selectFrom('status_reactions')
    .select(['name', 'actorId', 'createdAt'])
    .where('statusId', '=', statusId)
  if (name !== undefined) query = query.where('name', '=', name)

  const rows = await query
    .orderBy('createdAt', 'asc')
    .orderBy('actorId', 'asc')
    .execute()

  return rows.map((row): StatusReactionActor => ({
    name: row.name,
    actorId: row.actorId,
    // Nullable in the schema, but every writer sets it.
    createdAt: row.createdAt ?? 0
  }))
}

// The facade getSQLDatabase binds with bindDb().
export const statusReactionQueries = {
  createStatusReaction,
  deleteStatusReaction,
  getStatusReactionRollups,
  getStatusReactionActors
}
