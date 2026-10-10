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
// clauses that run before LIMIT. A boost is judged by its booster and by its
// original author. The Kysely twin of applyBlockMuteFilter
// (lib/database/sql/utils/blockMuteFilter.ts, which explains each rule);
// visibilityEquivalence.test.ts runs both over the same rows.
//
// `query` must select from `statuses` (it may join other tables). Like the
// Knex version it adds a left join, aliased block_mute_reblog_original, which
// the rest of the query should not reference; the returned type leaves the
// alias out for that reason.
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
