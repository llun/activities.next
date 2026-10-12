import { type ExpressionBuilder, type SelectQueryBuilder, sql } from 'kysely'

import type { DB } from '@/lib/database/kysely'

// The original status of a boost, left-joined so a block or mute can reach the
// boosted account, not just the booster.
const REBLOG_ORIGINAL_ALIAS = 'block_mute_reblog_original'

type ModeratedStatusesBuilder = ExpressionBuilder<
  DB & { [REBLOG_ORIGINAL_ALIAS]: DB['statuses'] },
  'statuses' | typeof REBLOG_ORIGINAL_ALIAS
>

// Drops the statuses of accounts the viewer blocks, is blocked by, or mutes
// (while the mute is active) from a query over `statuses`, as pure NOT EXISTS
// clauses, so they compose with the other timeline filters and run before
// LIMIT (no short pages, no backfill loop). The list and collection timelines
// read through it; it mirrors the filtering the home feed applies after the
// fetch (filterBlockedStatuses and filterMutedStatuses):
// - Blocks go both ways: an author the viewer blocks or who blocks the viewer
//   is hidden (as getBlockRelations reads them). The two directions are
//   separate NOT EXISTS clauses, not one OR'd subquery, so each can use its
//   own (actorId or targetActorId) index on `blocks`.
// - Mutes go one way (only what the viewer mutes) and expire: a mute is active
//   while endsAt IS NULL or endsAt >= now (as getMuteRelations reads them).
//   The mute's `notifications` flag governs notifications only, so every
//   active mute hides the author's statuses here.
// - As in the home feed's getRelevantStatusActorIds, a boost is judged by its
//   booster and by its original author, so a boost of a blocked or muted
//   account is hidden too. The original author comes from a left join on
//   statuses.originalStatusId (NULL for anything but a boost, so it never
//   matches).
// visibility.test.ts pins what it hides from each viewer.
//
// `query` must select from `statuses` (it may join other tables). It adds a
// left join, aliased block_mute_reblog_original, which the rest of the query
// should not reference; the returned type leaves the alias out for that
// reason.
export const withoutBlockedOrMutedAuthors = <TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  viewerActorId: string,
  now: number
): SelectQueryBuilder<DB, TB, O> => {
  // True when `moderatedColumn` (the moderated party on a block or mute row)
  // is the status author or, for a boost, the original author.
  const isRelevantAuthor = (
    eb: ModeratedStatusesBuilder,
    moderatedColumn: string
  ) =>
    eb.or([
      eb(sql.ref<string>(moderatedColumn), '=', eb.ref('statuses.actorId')),
      eb(
        sql.ref<string>(moderatedColumn),
        '=',
        eb.ref(`${REBLOG_ORIGINAL_ALIAS}.actorId`)
      )
    ])

  const statusesQuery = query as unknown as SelectQueryBuilder<
    DB,
    'statuses',
    O
  >
  return statusesQuery
    .leftJoin(
      `statuses as ${REBLOG_ORIGINAL_ALIAS}`,
      `${REBLOG_ORIGINAL_ALIAS}.id`,
      'statuses.originalStatusId'
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks as moderation_blocks_outgoing')
            .select(sql.lit(1).as('one'))
            .where('moderation_blocks_outgoing.actorId', '=', viewerActorId)
            .where((author) =>
              isRelevantAuthor(
                author,
                'moderation_blocks_outgoing.targetActorId'
              )
            )
        )
      )
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks as moderation_blocks_incoming')
            .select(sql.lit(1).as('one'))
            .where(
              'moderation_blocks_incoming.targetActorId',
              '=',
              viewerActorId
            )
            .where((author) =>
              isRelevantAuthor(author, 'moderation_blocks_incoming.actorId')
            )
        )
      )
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('mutes as moderation_mutes')
            .select(sql.lit(1).as('one'))
            .where('moderation_mutes.actorId', '=', viewerActorId)
            .where((active) =>
              active.or([
                active('moderation_mutes.endsAt', 'is', null),
                active('moderation_mutes.endsAt', '>=', now)
              ])
            )
            .where((author) =>
              isRelevantAuthor(author, 'moderation_mutes.targetActorId')
            )
        )
      )
    ) as unknown as SelectQueryBuilder<DB, TB, O>
}
