import { Knex } from 'knex'

// Alias for the original status of a boost, left-joined so block/mute can reach
// the boosted account, not just the booster.
const REBLOG_ORIGINAL_ALIAS = 'block_mute_reblog_original'

// Hide statuses authored by accounts the viewer blocks/mutes from a status-table
// timeline query, applied as pure NOT EXISTS clauses so they compose with the
// other list filters and run BEFORE LIMIT (no short pages, no backfill loop).
//
// Mirrors the read-time filtering the home feed applies post-fetch
// (filterBlockedStatuses + filterMutedStatuses), brought to the list timeline
// which queries the statuses table directly:
//   - Blocks are bidirectional: hide an author the viewer blocks OR who blocks
//     the viewer (matching getBlockRelations / filterBlockedStatuses). The two
//     directions are separate NOT EXISTS clauses (not one OR'd subquery) so each
//     can use its own (actorId|targetActorId) index on the blocks table.
//   - Mutes are one-directional (only what the viewer mutes) and expire: a mute
//     is active while endsAt IS NULL or endsAt >= now (matching getMuteRelations).
// The mute `notifications` flag governs notification muting only, so timeline
// filtering ignores it — every active mute hides the author's statuses.
//
// Like the home feed's getRelevantStatusActorIds, a boost (Announce) is judged
// by its booster AND its original author, so boosting a blocked/muted account
// is hidden too. The original author is resolved via a left join on
// statuses.originalStatusId (NULL for non-boosts, so it never matches).
export const applyBlockMuteFilter = ({
  database,
  query,
  viewerActorId,
  now
}: {
  database: Knex
  query: Knex.QueryBuilder
  viewerActorId: string
  now: number
}) => {
  query.leftJoin(
    `statuses as ${REBLOG_ORIGINAL_ALIAS}`,
    `${REBLOG_ORIGINAL_ALIAS}.id`,
    'statuses.originalStatusId'
  )

  // True when `moderationAuthorColumn` (the moderated party's id on a block/mute
  // row) equals the status author or, for a boost, the original author. Both
  // compare the same indexed column to a value, so this stays index-friendly.
  const matchesRelevantAuthor = (
    builder: Knex.QueryBuilder,
    moderationAuthorColumn: string
  ) => {
    builder.where((author) => {
      author
        .whereRaw('?? = ??', [moderationAuthorColumn, 'statuses.actorId'])
        .orWhereRaw('?? = ??', [
          moderationAuthorColumn,
          `${REBLOG_ORIGINAL_ALIAS}.actorId`
        ])
    })
  }

  query
    .whereNotExists(function () {
      this.select(database.raw('1')).from(
        'blocks as moderation_blocks_outgoing'
      )
      this.where('moderation_blocks_outgoing.actorId', viewerActorId)
      matchesRelevantAuthor(this, 'moderation_blocks_outgoing.targetActorId')
    })
    .whereNotExists(function () {
      this.select(database.raw('1')).from(
        'blocks as moderation_blocks_incoming'
      )
      this.where('moderation_blocks_incoming.targetActorId', viewerActorId)
      matchesRelevantAuthor(this, 'moderation_blocks_incoming.actorId')
    })
    .whereNotExists(function () {
      this.select(database.raw('1')).from('mutes as moderation_mutes')
      this.where('moderation_mutes.actorId', viewerActorId).where((active) => {
        active
          .whereNull('moderation_mutes.endsAt')
          .orWhere('moderation_mutes.endsAt', '>=', now)
      })
      matchesRelevantAuthor(this, 'moderation_mutes.targetActorId')
    })
}
