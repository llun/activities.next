/**
 * One-time backfill of materialized list feeds. List timelines are now read from
 * the `timelines` table (keyed `list:<listId>`, scoped by the owner's actorId)
 * instead of a live statuses⋈list_accounts join. This populates that partition
 * for every existing membership so list timelines have full history immediately.
 *
 * Idempotent: inserts ignore conflicts on the unique (actorId, timeline,
 * statusId), so re-running heals drift instead of duplicating rows. Statuses are
 * read per distinct member in chunked IN queries (not one query per membership)
 * so an account on many lists is fetched once per chunk, and the chunk sizes keep
 * both the SELECT and INSERT under SQLite's 999 bound-parameter limit.
 */
// Normalize a stored createdAt to a Date the same way the runtime fan-out does
// (lib/database/sql/utils/getCompatibleTime + new Date), so list rows written
// here serialize identically to rows written at runtime — the list read orders
// by timelines.createdAt, so mixed formats in one partition would break it.
// SQLite returns "YYYY-MM-DD HH:MM:SS(.sss)" UTC strings without a zone, so the
// missing 'Z' is added before parsing to avoid a local-time shift.
const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/
const toDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  const trimmed = String(value).trim()
  // Defensive: a Postgres bigint column would come back as an all-digits string
  // (epoch ms) — new Date('1700000000000') is Invalid, so parse it as a number.
  // (statuses.createdAt is a timestamp here, so this normally never triggers.)
  if (/^\d+$/.test(trimmed)) return new Date(Number(trimmed))
  const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed
  return new Date(normalized)
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const memberships = await knex('list_accounts').select(
    'listId',
    'actorId',
    'targetActorId'
  )
  if (memberships.length === 0) return

  // Group the (owner, list) destinations by member so each member's statuses are
  // fetched once and fanned out to every list that contains them.
  const destinationsByMember = new Map()
  for (const membership of memberships) {
    const destinations =
      destinationsByMember.get(membership.targetActorId) ?? []
    destinations.push({
      ownerId: membership.actorId,
      listId: membership.listId
    })
    destinationsByMember.set(membership.targetActorId, destinations)
  }
  const memberIds = [...destinationsByMember.keys()]

  const now = new Date()
  const SELECT_CHUNK = 200
  const INSERT_CHUNK = 100
  for (let i = 0; i < memberIds.length; i += SELECT_CHUNK) {
    const memberChunk = memberIds.slice(i, i + SELECT_CHUNK)
    const statuses = await knex('statuses')
      .whereIn('actorId', memberChunk)
      .select('id', 'actorId', 'createdAt')
    const rows = []
    for (const statusRow of statuses) {
      // Every fetched actorId came from memberChunk (a subset of the map keys),
      // so this is normally always present; guard defensively so unexpected data
      // (e.g. a casing mismatch) skips the row instead of crashing the migration.
      const destinations = destinationsByMember.get(statusRow.actorId)
      if (!destinations) continue
      for (const { ownerId, listId } of destinations) {
        rows.push({
          actorId: ownerId,
          timeline: `list:${listId}`,
          statusId: statusRow.id,
          statusActorId: statusRow.actorId,
          createdAt: toDate(statusRow.createdAt),
          updatedAt: now
        })
      }
    }
    for (let j = 0; j < rows.length; j += INSERT_CHUNK) {
      await knex('timelines')
        .insert(rows.slice(j, j + INSERT_CHUNK))
        .onConflict(['actorId', 'timeline', 'statusId'])
        .ignore()
    }
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex('timelines').where('timeline', 'like', 'list:%').delete()
}
