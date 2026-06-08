import { Knex } from 'knex'

// Hide statuses authored by accounts the viewer blocks/mutes from a status-table
// timeline query, applied as pure NOT EXISTS clauses so they compose with the
// other list filters and run BEFORE LIMIT (no short pages, no backfill loop).
//
// Mirrors the read-time filtering the home feed applies post-fetch
// (filterBlockedStatuses + filterMutedStatuses), brought to the list timeline
// which queries the statuses table directly:
//   - Blocks are bidirectional: hide an author the viewer blocks OR who blocks
//     the viewer (matching getBlockRelations / filterBlockedStatuses).
//   - Mutes are one-directional (only what the viewer mutes) and expire: a mute
//     is active while endsAt IS NULL or endsAt >= now (matching getMuteRelations).
// The mute `notifications` flag governs notification muting only, so timeline
// filtering ignores it — every active mute hides the author's statuses.
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
  query
    .whereNotExists(function () {
      this.select(database.raw('1'))
        .from('blocks as moderation_blocks')
        .where((relation) => {
          relation
            .where((forward) => {
              forward
                .where('moderation_blocks.actorId', viewerActorId)
                .whereRaw('?? = ??', [
                  'moderation_blocks.targetActorId',
                  'statuses.actorId'
                ])
            })
            .orWhere((reverse) => {
              reverse
                .where('moderation_blocks.targetActorId', viewerActorId)
                .whereRaw('?? = ??', [
                  'moderation_blocks.actorId',
                  'statuses.actorId'
                ])
            })
        })
    })
    .whereNotExists(function () {
      this.select(database.raw('1'))
        .from('mutes as moderation_mutes')
        .where('moderation_mutes.actorId', viewerActorId)
        .whereRaw('?? = ??', [
          'moderation_mutes.targetActorId',
          'statuses.actorId'
        ])
        .where((active) => {
          active
            .whereNull('moderation_mutes.endsAt')
            .orWhere('moderation_mutes.endsAt', '>=', now)
        })
    })
}
